import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AssetStore } from "../src/asset-store.js";
import { ConfigStore, RevisionConflictError } from "../src/config-store.js";
import { Controller } from "../src/controller.js";
import { DeviceManager } from "../src/device/device-manager.js";
import { ControllerHttpServer } from "../src/http-server.js";

class RecordingActionRunner {
  constructor() {
    this.actions = [];
  }

  async run(action) {
    this.actions.push(action);
    return { executed: true, type: action.type, pid: 1234 };
  }
}

async function fixture(t, { aiLayoutService } = {}) {
  const root = await mkdtemp(join(tmpdir(), "m18-controller-test-"));
  const actionRunner = new RecordingActionRunner();
  const controller = new Controller({
    configStore: new ConfigStore({ directory: join(root, "config") }),
    assetStore: new AssetStore({ directory: join(root, "assets") }),
    deviceManager: new DeviceManager({ mode: "mock" }),
    actionRunner,
  });
  await controller.initialize();
  const server = new ControllerHttpServer(controller, {
    port: 0,
    ...(aiLayoutService ? { aiLayoutService } : {}),
  });
  await server.listen();
  t.after(async () => {
    await server.close();
    await controller.stop();
    await rm(root, { recursive: true, force: true });
  });
  return { controller, actionRunner, server };
}

test("controller applies 15 rendered keys through the simulator", async (t) => {
  const { controller } = await fixture(t);
  const result = await controller.applyActiveProfile();
  assert.deepEqual(result, {
    applied: true,
    profileId: controller.getState().config.activeProfileId,
    keys: 15,
  });
  assert.equal(controller.deviceManager.adapter.images.size, 15);
  assert.equal(controller.getState().operation.state, "complete");
  assert.equal(controller.getState().appliedState.inSync, true);
});

test("physical presses use the last fully applied action snapshot", async (t) => {
  const { controller, actionRunner } = await fixture(t);
  const initial = controller.getState();
  const first = structuredClone(initial.config);
  first.profiles[0].keys[0].action = {
    type: "command",
    executable: "playerctl",
    args: ["play-pause"],
  };
  await controller.replaceConfig(first, initial.config.revision);
  await controller.applyActiveProfile();

  const applied = controller.getState();
  const second = structuredClone(applied.config);
  second.profiles[0].keys[0].action = {
    type: "command",
    executable: "playerctl",
    args: ["next"],
  };
  await controller.replaceConfig(second, applied.config.revision);
  assert.equal(controller.getState().appliedState.inSync, false);

  await controller.triggerButton({ key: 1, source: "hardware" });
  assert.deepEqual(actionRunner.actions.at(-1), {
    type: "command",
    executable: "playerctl",
    args: ["play-pause"],
  });
});

test("physical actions are blocked until a profile is fully applied", async (t) => {
  const { controller, actionRunner } = await fixture(t);
  await assert.rejects(
    () => controller.triggerButton({ key: 1, source: "hardware" }),
    /Apply a profile/,
  );
  assert.equal(actionRunner.actions.length, 0);
});

test("re-sending unchanged lighting does not rewrite configuration", async (t) => {
  const { controller } = await fixture(t);
  const initial = controller.getState();
  const brightness = await controller.setBrightness({
    value: initial.config.device.brightness,
    expectedRevision: initial.config.revision,
  });
  const lighting = await controller.setLedColor({
    color: initial.config.device.ledColor,
    expectedRevision: brightness.revision,
  });
  assert.equal(lighting.revision, initial.config.revision);
  assert.equal(controller.deviceManager.adapter.brightness, initial.config.device.brightness);
  assert.equal(controller.deviceManager.adapter.ledColor, initial.config.device.ledColor);
});

test("external actions require confirmation outside a physical press", async (t) => {
  const { controller, actionRunner } = await fixture(t);
  const state = controller.getState();
  const config = structuredClone(state.config);
  config.profiles[0].keys[0].action = {
    type: "command",
    executable: "playerctl",
    args: ["play-pause"],
  };
  await controller.replaceConfig(config, state.config.revision);
  const inspected = controller.getState();
  const snapshot = {
    key: 1,
    source: "api",
    expectedProfileId: inspected.config.activeProfileId,
    expectedRevision: inspected.config.revision,
    expectedAction: inspected.config.profiles[0].keys[0].action,
  };
  await assert.rejects(() => controller.triggerButton(snapshot), /confirm=true/);
  await assert.rejects(
    () => controller.triggerButton({ ...snapshot, confirm: true, expectedAction: { type: "none" } }),
    /action changed/,
  );
  await controller.triggerButton({ ...snapshot, confirm: true });
  assert.equal(actionRunner.actions.length, 1);
});

test("a stale inspected action cannot execute after configuration changes", async (t) => {
  const { controller, actionRunner } = await fixture(t);
  const initial = controller.getState();
  const first = structuredClone(initial.config);
  first.profiles[0].keys[0].action = {
    type: "command",
    executable: "playerctl",
    args: ["play-pause"],
  };
  await controller.replaceConfig(first, initial.config.revision);
  const inspected = controller.getState();

  const changed = structuredClone(inspected.config);
  changed.profiles[0].keys[0].action = {
    type: "command",
    executable: "playerctl",
    args: ["next"],
  };
  await controller.replaceConfig(changed, inspected.config.revision);

  await assert.rejects(
    () => controller.triggerButton({
      key: 1,
      confirm: true,
      source: "api",
      expectedProfileId: inspected.config.activeProfileId,
      expectedRevision: inspected.config.revision,
      expectedAction: inspected.config.profiles[0].keys[0].action,
    }),
    RevisionConflictError,
  );
  assert.equal(actionRunner.actions.length, 0);
});

test("HTTP API is loopback-scoped and rejects unmarked mutations", async (t) => {
  const { server } = await fixture(t);
  const unauthenticated = await fetch(`${server.url}/api/state`);
  assert.equal(unauthenticated.status, 401);

  const instanceHeaders = { "X-VSD-Instance-Token": server.instanceToken };
  const stateResponse = await fetch(`${server.url}/api/state`, { headers: instanceHeaders });
  assert.equal(stateResponse.status, 200);
  const state = await stateResponse.json();
  assert.equal(state.device.state, "connected");

  const rejected = await fetch(`${server.url}/api/device/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...instanceHeaders },
    body: "{}",
  });
  assert.equal(rejected.status, 403);

  const unboundApply = await fetch(`${server.url}/api/device/apply`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-VSD-Local-Client": "ui",
      ...instanceHeaders,
    },
    body: "{}",
  });
  assert.equal(unboundApply.status, 400);

  const stringConfirmation = await fetch(`${server.url}/api/actions/trigger`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-VSD-Local-Client": "ui",
      ...instanceHeaders,
    },
    body: JSON.stringify({
      profileId: state.config.activeProfileId,
      key: 1,
      expectedRevision: state.config.revision,
      expectedAction: state.config.profiles[0].keys[0].action,
      confirm: "false",
    }),
  });
  assert.equal(stringConfirmation.status, 400);

  const finalProfile = await fetch(
    `${server.url}/api/profiles/${encodeURIComponent(state.config.activeProfileId)}`,
    {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "X-VSD-Local-Client": "ui",
        ...instanceHeaders,
      },
      body: JSON.stringify({ expectedRevision: state.config.revision }),
    },
  );
  assert.equal(finalProfile.status, 409);

  const accepted = await fetch(`${server.url}/api/device/apply`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-VSD-Local-Client": "ui",
      ...instanceHeaders,
    },
    body: JSON.stringify({
      profileId: state.config.activeProfileId,
      expectedRevision: state.config.revision,
    }),
  });
  assert.equal(accepted.status, 200);

  const index = await fetch(`${server.url}/`);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /M18 Foundry/);
});

test("HTTP API resolves shortcuts and proxies AI drafts without persisting credentials", async (t) => {
  const calls = [];
  const aiLayoutService = {
    async listModels(input) {
      calls.push({ type: "models", input });
      return { provider: input.provider, models: ["test-model"] };
    },
    async generate(input) {
      calls.push({ type: "layout", input });
      return { provider: input.provider, model: input.model, layout: { summary: "Test", keys: [] } };
    },
  };
  const { server } = await fixture(t, { aiLayoutService });
  const headers = {
    "Content-Type": "application/json",
    "X-VSD-Local-Client": "ui",
    "X-VSD-Instance-Token": server.instanceToken,
  };

  const shortcutResponse = await fetch(`${server.url}/api/shortcuts/resolve`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "Music.desktop",
      content: "[Desktop Entry]\nType=Application\nName=Music\nExec=/usr/bin/playerctl play-pause",
    }),
  });
  assert.equal(shortcutResponse.status, 200);
  assert.deepEqual((await shortcutResponse.json()).shortcut.action, {
    type: "command",
    executable: "/usr/bin/playerctl",
    args: ["play-pause"],
  });

  const modelsResponse = await fetch(`${server.url}/api/ai/models`, {
    method: "POST",
    headers,
    body: JSON.stringify({ provider: "openai", apiKey: "session-only" }),
  });
  assert.equal(modelsResponse.status, 200);
  assert.deepEqual((await modelsResponse.json()).models, ["test-model"]);

  const layoutResponse = await fetch(`${server.url}/api/ai/layout`, {
    method: "POST",
    headers,
    body: JSON.stringify({ provider: "openai", apiKey: "session-only", model: "test-model" }),
  });
  assert.equal(layoutResponse.status, 200);
  assert.equal((await layoutResponse.json()).model, "test-model");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].input.apiKey, "session-only");
  assert.equal(controllerStateHasCredential(server.controller.getState(), "session-only"), false);
});

function controllerStateHasCredential(state, credential) {
  return JSON.stringify(state).includes(credential);
}
