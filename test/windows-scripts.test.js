import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const launcherPath = new URL("../scripts/open-controller.ps1", import.meta.url);
const installerPath = new URL("../scripts/install-windows.ps1", import.meta.url);

test("Windows launcher follows the private dynamic-instance contract", async () => {
  const launcher = await readFile(launcherPath, "utf8");
  assert.doesNotMatch(launcher, /127\.0\.0\.1:31918/);
  assert.match(launcher, /X-VSD-Instance-Token/);
  assert.match(launcher, /instance\.json/);
  assert.match(launcher, /ProcessStartInfo/);
  assert.match(launcher, /--windows-launch-id=/);
  assert.match(launcher, /CreationDate/);
  assert.match(launcher, /VSD_M18_PORT"\] = "0"/);
});

test("Windows installer mutates only verified app-owned paths and shortcuts", async () => {
  const installer = await readFile(installerPath, "utf8");
  assert.doesNotMatch(installer, /127\.0\.0\.1:31918/);
  assert.match(installer, /X-VSD-Instance-Token/);
  assert.match(installer, /Test-ManagedInstallRoot/);
  assert.match(installer, /controller\.lock/);
  assert.match(installer, /codex-vsd-m18-controller/);
  assert.match(installer, /ExpectedTargetPath/);
  assert.match(installer, /ExpectedArguments/);
  assert.match(installer, /restoring the previous verified installation/i);
});
