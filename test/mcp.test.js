import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const MCP_ENTRY = fileURLToPath(new URL("../src/mcp-server.js", import.meta.url));

function waitForMessage(messages, predicate, timeout = 10_000) {
  const existing = messages.find(predicate);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const match = messages.find(predicate);
      if (match) {
        clearInterval(timer);
        resolve(match);
      } else if (Date.now() - started > timeout) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for MCP response; received ${JSON.stringify(messages)}`));
      }
    }, 20);
  });
}

test("MCP stdio server negotiates, lists tools, and reads simulator status", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "m18-mcp-test-"));
  const port = 34_000 + Math.floor(Math.random() * 2_000);
  const child = spawn(process.execPath, [MCP_ENTRY], {
    env: {
      ...process.env,
      VSD_M18_CONFIG_HOME: join(root, "config"),
      VSD_M18_DATA_HOME: join(root, "data"),
      VSD_M18_RUNTIME_HOME: join(root, "runtime"),
      VSD_M18_MODE: "mock",
      VSD_M18_PORT: String(port),
      VSD_M18_NO_BROWSER: "1",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const messages = [];
  let stdoutBuffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop();
    for (const line of lines) {
      if (line.trim()) messages.push(JSON.parse(line));
    }
  });
  t.after(async () => {
    child.kill("SIGTERM");
    try {
      const descriptor = JSON.parse(
        await readFile(join(root, "runtime", "instance.json"), "utf8"),
      );
      const health = await fetch(`http://127.0.0.1:${port}/api/health`, {
        headers: { "X-VSD-Instance-Token": descriptor.token },
        signal: AbortSignal.timeout(500),
      }).then((response) => response.json());
      process.kill(health.pid, "SIGTERM");
    } catch {
      // The service may already have exited.
    }
    await rm(root, { recursive: true, force: true });
  });

  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "m18-test", version: "1.0.0" },
    },
  });
  const initialized = await waitForMessage(messages, (message) => message.id === 1);
  assert.equal(initialized.result.serverInfo.name, "vsd-m18-controller");
  send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });

  send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  const listed = await waitForMessage(messages, (message) => message.id === 2);
  const names = listed.result.tools.map((tool) => tool.name);
  assert.ok(names.includes("dock_status"));
  assert.ok(names.includes("update_key"));
  assert.ok(names.includes("trigger_button"));
  assert.equal(names.length, 11);
  const triggerTool = listed.result.tools.find((tool) => tool.name === "trigger_button");
  assert.deepEqual(
    new Set(triggerTool.inputSchema.required),
    new Set(["profile_id", "key", "expected_revision", "expected_action"]),
  );
  const applyTool = listed.result.tools.find((tool) => tool.name === "apply_profile");
  assert.deepEqual(
    new Set(applyTool.inputSchema.required),
    new Set(["profile_id", "expected_revision"]),
  );

  send({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "dock_status", arguments: {} },
  });
  const called = await waitForMessage(messages, (message) => message.id === 3);
  assert.equal(called.result.isError, undefined);
  assert.equal(called.result.structuredContent.device.state, "connected");
  assert.equal(called.result.structuredContent.device.device.simulated, true);

  send({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "get_profile", arguments: {} },
  });
  const profileRead = await waitForMessage(messages, (message) => message.id === 4);
  const { profile, revision } = profileRead.result.structuredContent;

  send({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: {
      name: "apply_profile",
      arguments: { profile_id: profile.id, expected_revision: revision },
    },
  });
  const applied = await waitForMessage(messages, (message) => message.id === 5);
  assert.equal(applied.result.structuredContent.result.applied, true);
  assert.equal(applied.result.structuredContent.state.appliedState.inSync, true);

  send({
    jsonrpc: "2.0",
    id: 6,
    method: "tools/call",
    params: {
      name: "trigger_button",
      arguments: {
        profile_id: profile.id,
        key: 1,
        expected_revision: revision,
        expected_action: profile.keys[0].action,
        confirm: false,
      },
    },
  });
  const triggered = await waitForMessage(messages, (message) => message.id === 6);
  assert.equal(triggered.result.structuredContent.result.result.executed, false);
  child.stdin.end();
});
