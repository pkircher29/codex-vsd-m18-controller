import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const serverEntry = fileURLToPath(new URL("../src/server.js", import.meta.url));

async function waitForDescriptor(path) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return JSON.parse(await readFile(path, "utf8"));
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error("The server did not publish its instance descriptor");
}

test("server publishes, protects, and clears a dynamic local instance", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "m18-server-instance-"));
  const runtime = join(root, "runtime");
  const descriptorPath = join(runtime, "instance.json");
  const child = spawn(process.execPath, [serverEntry, "--mock", "--headless"], {
    env: {
      ...process.env,
      VSD_M18_CONFIG_HOME: join(root, "config"),
      VSD_M18_DATA_HOME: join(root, "data"),
      VSD_M18_RUNTIME_HOME: runtime,
      VSD_M18_MODE: "mock",
      VSD_M18_PORT: "0",
      VSD_M18_NO_BROWSER: "1",
    },
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  let exited = false;
  const exitPromise = new Promise((resolve, reject) => {
    child.once("exit", (code, signal) => {
      exited = true;
      if (code === 0 || signal === "SIGTERM") resolve();
      else reject(new Error(`server exited with code ${code}`));
    });
  });
  t.after(async () => {
    if (!exited) {
      child.kill("SIGTERM");
      await exitPromise.catch(() => undefined);
    }
    await rm(root, { recursive: true, force: true });
  });

  const descriptor = await waitForDescriptor(descriptorPath);
  assert.ok(Number.isInteger(descriptor.port));
  assert.ok(descriptor.port > 0);
  const baseUrl = `http://127.0.0.1:${descriptor.port}`;

  const denied = await fetch(`${baseUrl}/api/health`);
  assert.equal(denied.status, 401);

  const headers = { "X-VSD-Instance-Token": descriptor.token };
  const health = await fetch(`${baseUrl}/api/health`, { headers }).then((response) => response.json());
  assert.deepEqual(health, { ok: true, version: "0.2.1", pid: descriptor.pid });

  const state = await fetch(`${baseUrl}/api/state`, { headers }).then((response) => response.json());
  assert.equal(state.device.state, "connected");
  assert.equal(state.runtime.platform, process.platform);

  const index = await fetch(`${baseUrl}/`).then((response) => response.text());
  assert.match(index, /M18 Foundry/);
  assert.match(index, /<select id="aiModel"/);
  assert.match(index, /<dialog[\s\S]*id="setupWizard"/);
  assert.match(index, /id="setupApplyNow"/);
  assert.doesNotMatch(index, /<datalist id="aiModelList"/);
  const appScript = await fetch(`${baseUrl}/app.js?v=test`);
  assert.equal(appScript.status, 200);
  assert.equal(appScript.headers.get("cache-control"), "no-cache");
  const favicon = await fetch(`${baseUrl}/favicon.svg`);
  assert.equal(favicon.status, 200);
  assert.equal(favicon.headers.get("content-type"), "image/svg+xml");

  child.send({ type: "vsd-m18:shutdown" });
  await exitPromise;
  await assert.rejects(readFile(descriptorPath, "utf8"), { code: "ENOENT" });
});
