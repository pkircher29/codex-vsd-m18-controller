import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDefaultConfig, validateConfig } from "../src/config-schema.js";
import { ConfigStore, RevisionConflictError } from "../src/config-store.js";

test("default configuration has a complete 18-key profile", () => {
  const config = validateConfig(createDefaultConfig());
  assert.equal(config.schemaVersion, 1);
  assert.equal(config.revision, 0);
  assert.equal(config.setup.completed, false);
  assert.equal(config.profiles.length, 1);
  assert.equal(config.profiles[0].keys.length, 18);
  assert.deepEqual(
    config.profiles[0].keys.slice(15).map((key) => key.label),
    ["BACK", "HOME", "NEXT"],
  );
});

test("legacy configurations infer setup completion without changing the schema version", () => {
  const legacy = createDefaultConfig();
  legacy.revision = 3;
  delete legacy.setup;
  assert.equal(validateConfig(legacy).setup.completed, true);

  legacy.revision = 0;
  assert.equal(validateConfig(legacy).setup.completed, false);
});

test("configuration validation rejects invalid numeric state and bottom-key art", () => {
  const invalidBrightness = createDefaultConfig();
  invalidBrightness.device.brightness = "not-a-number";
  assert.throws(() => validateConfig(invalidBrightness), /brightness/);

  const invalidAsset = createDefaultConfig();
  invalidAsset.profiles[0].keys[15].assetId = `${"a".repeat(64)}.png`;
  assert.throws(() => validateConfig(invalidAsset), /only valid for LCD keys/);
});

test("command arguments preserve exact whitespace and argument boundaries", () => {
  const config = createDefaultConfig();
  config.profiles[0].keys[0].action = {
    type: "command",
    executable: "/usr/bin/printf",
    args: ["  padded  ", "", "%s\\n"],
  };
  const validated = validateConfig(config);
  assert.deepEqual(validated.profiles[0].keys[0].action.args, ["  padded  ", "", "%s\\n"]);
});

test("ConfigStore writes atomically, detects revision conflicts, and recovers its backup", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "m18-config-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new ConfigStore({ directory });
  await store.initialize();
  const initial = store.get();
  initial.device.brightness = 41;
  const saved = await store.replace(initial, 0);
  assert.equal(saved.revision, 1);
  assert.equal(saved.device.brightness, 41);
  await assert.rejects(() => store.replace(saved, 0), RevisionConflictError);

  const disk = JSON.parse(await readFile(join(directory, "config.json"), "utf8"));
  assert.equal(disk.revision, 1);
  if (process.platform !== "win32") {
    assert.equal((await stat(join(directory, "config.json"))).mode & 0o777, 0o600);
    assert.equal((await stat(join(directory, "config.json.bak"))).mode & 0o777, 0o600);
  }
  assert.deepEqual(
    (await readdir(directory)).filter((entry) => entry.endsWith(".tmp")),
    [],
  );
  await writeFile(join(directory, "config.json"), "{broken-json", "utf8");

  const recovered = new ConfigStore({ directory });
  const config = await recovered.initialize();
  assert.equal(config.revision, 0);
  assert.match(recovered.recoveryNotice, /Recovered/);
});
