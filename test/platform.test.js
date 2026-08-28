import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import test from "node:test";
import { ActionRunner } from "../src/action-runner.js";
import { isControlInterface } from "../src/device/device-manager.js";
import {
  InstanceSession,
  instanceTokensEqual,
  readInstanceDescriptor,
} from "../src/instance-session.js";
import {
  deviceEventMonitorSpec,
  externalOpenSpec,
  runtimeInfo,
} from "../src/platform.js";
import { configDirectory, dataDirectory, runtimeDirectory } from "../src/util.js";

test("Windows paths use roaming config and local data without XDG assumptions", () => {
  const env = {
    APPDATA: "C:\\Users\\Paul\\AppData\\Roaming",
    LOCALAPPDATA: "C:\\Users\\Paul\\AppData\\Local",
    USERPROFILE: "C:\\Users\\Paul",
  };
  assert.equal(configDirectory(env, "win32"), win32.join(env.APPDATA, "M18Foundry"));
  assert.equal(dataDirectory(env, "win32"), win32.join(env.LOCALAPPDATA, "M18Foundry"));
  assert.equal(
    runtimeDirectory(env, "win32"),
    win32.join(env.LOCALAPPDATA, "M18Foundry", "runtime"),
  );
});

test("application-specific directories isolate tests on every operating system", () => {
  const env = {
    VSD_M18_CONFIG_HOME: "/isolated/config",
    VSD_M18_DATA_HOME: "/isolated/data",
    VSD_M18_RUNTIME_HOME: "/isolated/runtime",
  };
  assert.equal(configDirectory(env, "win32"), env.VSD_M18_CONFIG_HOME);
  assert.equal(dataDirectory(env, "win32"), env.VSD_M18_DATA_HOME);
  assert.equal(runtimeDirectory(env, "win32"), env.VSD_M18_RUNTIME_HOME);
});

test("Linux runtime state avoids shared temporary-directory ownership", () => {
  assert.equal(
    runtimeDirectory({ XDG_RUNTIME_DIR: "/run/user/1000" }, "linux", "/home/paul"),
    "/run/user/1000/vsd-m18-controller",
  );
  assert.equal(
    runtimeDirectory({}, "linux", "/home/paul"),
    "/home/paul/.config/vsd-m18-controller/runtime",
  );
});

test("Windows opens URLs without embedding user data in a shell command", () => {
  const target = "https://example.com/?one=1&two='quoted'";
  const spec = externalOpenSpec(target, {
    platform: "win32",
    env: { SystemRoot: "C:\\Windows" },
  });
  assert.equal(
    spec.executable,
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  );
  assert.ok(spec.args.includes("Start-Process -FilePath $env:VSD_M18_OPEN_TARGET"));
  assert.ok(!spec.args.some((argument) => argument.includes(target)));
  assert.equal(spec.env.VSD_M18_OPEN_TARGET, target);
  assert.deepEqual(runtimeInfo("win32"), { platform: "win32", platformLabel: "Windows" });
});

test("Windows device events use a native event subscription rather than HID polling", () => {
  const spec = deviceEventMonitorSpec({
    platform: "win32",
    env: { SystemRoot: "C:\\Windows" },
  });
  assert.match(spec.args.at(-1), /Register-CimIndicationEvent/);
  assert.match(spec.args.at(-1), /Win32_DeviceChangeEvent/);
});

test("Windows M18 filtering accepts only the vendor control collection", () => {
  assert.equal(isControlInterface({ usagePage: 0xffa0, usage: 1 }, "win32"), true);
  assert.equal(isControlInterface({ usagePage: 1, usage: 6 }, "win32"), false);
  assert.equal(
    isControlInterface({ path: "\\\\?\\hid#vid_5548&pid_1000&mi_00#7&abc" }, "win32"),
    true,
  );
  assert.equal(
    isControlInterface({ path: "\\\\?\\hid#vid_5548&pid_1000&mi_01#7&abc" }, "win32"),
    false,
  );
  assert.equal(isControlInterface({ interface: null }, "linux"), true);
});

test("Windows batch actions stay outside the command shell", async () => {
  const runner = new ActionRunner({ platform: "win32" });
  await assert.rejects(
    () => runner.run({ type: "command", executable: "C:\\Tools\\unsafe.cmd", args: [] }),
    /does not invoke/,
  );
});

test("instance descriptors are private, validated, and removed only by their owner", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "m18-instance-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const session = new InstanceSession({ directory });
  const descriptor = await session.publish({ host: "127.0.0.1", port: 31918, pid: 1234 });
  assert.equal(instanceTokensEqual(descriptor.token, session.token), true);
  assert.deepEqual(await readInstanceDescriptor({ directory }), descriptor);
  assert.match(await readFile(join(directory, "instance.json"), "utf8"), /"token"/);
  if (process.platform !== "win32") {
    assert.equal((await stat(join(directory, "instance.json"))).mode & 0o777, 0o600);
  }

  const other = new InstanceSession({ directory });
  await other.clear();
  assert.deepEqual(await readInstanceDescriptor({ directory }), descriptor);
  await session.clear();
  assert.equal(await readInstanceDescriptor({ directory }), null);
});

test("instance lock serializes controller startup and releases by token", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "m18-instance-lock-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const first = new InstanceSession({ directory });
  const second = new InstanceSession({ directory });
  assert.equal(await first.acquire(), true);
  assert.equal(await second.acquire(), false);
  await first.clear();
  assert.equal(await second.acquire(), true);
  await second.clear();
});
