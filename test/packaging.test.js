import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { APP_VERSION } from "../src/constants.js";

const projectFile = (path) => new URL(`../${path}`, import.meta.url);

test("package metadata defines matching native installers", async () => {
  const packageJson = JSON.parse(await readFile(projectFile("package.json"), "utf8"));
  assert.equal(packageJson.version, APP_VERSION);
  assert.equal(packageJson.main, "desktop/main.cjs");
  assert.equal(packageJson.desktopName, "com.pkircher.m18foundry.desktop");
  assert.equal(packageJson.build.win.target, "nsis");
  assert.deepEqual(packageJson.build.linux.target, ["AppImage", "deb"]);
  assert.equal(packageJson.build.nsis.perMachine, false);
  assert.equal(packageJson.build.nsis.deleteAppDataOnUninstall, false);
  assert.equal(packageJson.build.deb.afterInstall, "build/linux-after-install.sh");
  assert.equal(packageJson.build.deb.afterRemove, "build/linux-after-remove.sh");
  assert.equal(packageJson.build.npmRebuild, false);
});

test("desktop renderer remains isolated from Node and Electron privileges", async () => {
  const main = await readFile(projectFile("desktop/main.cjs"), "utf8");
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /setPermissionRequestHandler/);
  assert.match(main, /will-attach-webview/);
  assert.match(main, /setWindowOpenHandler/);
  assert.match(main, /ELECTRON_RUN_AS_NODE/);
  assert.match(main, /fork\(serverEntry/);
});

test("release workflow builds both platforms and publishes checksums", async () => {
  const workflow = await readFile(projectFile(".github/workflows/release.yml"), "utf8");
  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /ubuntu-latest/);
  assert.match(workflow, /npm run package:windows/);
  assert.match(workflow, /npm run package:linux/);
  assert.match(workflow, /sha256sum \* > SHA256SUMS\.txt/);
  assert.match(workflow, /gh release create/);
  assert.doesNotMatch(workflow, /uses:\s+[^\s]+@(v\d+|main|master)\s*$/m);
});

test("Debian package scripts manage only the M18-specific udev rule", async () => {
  const install = await readFile(projectFile("build/linux-after-install.sh"), "utf8");
  const remove = await readFile(projectFile("build/linux-after-remove.sh"), "utf8");
  const rule = await readFile(projectFile("linux/40-vsd-m18.rules"));
  const ruleHash = createHash("sha256").update(rule).digest("hex");
  assert.match(install, /40-vsd-m18\.rules/);
  assert.match(install, /install -o root -g root -m 0644/);
  assert.match(remove, new RegExp(ruleHash));
  assert.doesNotMatch(install, /MODE=\"0666\"/);
});
