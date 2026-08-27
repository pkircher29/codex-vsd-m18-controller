import { constants as fsConstants } from "node:fs";
import { access, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { MAX_CONFIG_BYTES } from "./constants.js";
import { createDefaultConfig, validateConfig } from "./config-schema.js";
import { configDirectory, errorMessage, jsonClone } from "./util.js";

export class RevisionConflictError extends Error {
  constructor(expected, actual) {
    super(`Configuration changed: expected revision ${expected}, current revision is ${actual}`);
    this.name = "RevisionConflictError";
    this.expected = expected;
    this.actual = actual;
  }
}

async function exists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path) {
  const text = await readFile(path, { encoding: "utf8" });
  if (Buffer.byteLength(text, "utf8") > MAX_CONFIG_BYTES) {
    throw new Error("Configuration file exceeds the 5 MB safety limit");
  }
  return JSON.parse(text);
}

async function fsyncDirectory(path) {
  let handle;
  try {
    handle = await open(path, "r");
    await handle.sync();
  } catch {
    // Some filesystems do not allow fsync on directory handles.
  } finally {
    await handle?.close();
  }
}

export class ConfigStore {
  #queue = Promise.resolve();
  #config = null;
  #recoveryNotice = null;

  constructor({ directory = configDirectory(), fileName = "config.json" } = {}) {
    this.directory = directory;
    this.path = join(directory, fileName);
    this.backupPath = `${this.path}.bak`;
  }

  get recoveryNotice() {
    return this.#recoveryNotice;
  }

  async initialize() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    if (!(await exists(this.path))) {
      this.#config = validateConfig(createDefaultConfig());
      await this.#atomicWrite(this.#config, { createBackup: false });
      return this.get();
    }

    try {
      this.#config = validateConfig(await readJson(this.path));
      return this.get();
    } catch (primaryError) {
      try {
        this.#config = validateConfig(await readJson(this.backupPath));
        this.#recoveryNotice = `Recovered the last known-good configuration after ${errorMessage(primaryError)}`;
        await this.#atomicWrite(this.#config, { createBackup: false });
        return this.get();
      } catch (backupError) {
        const corruptPath = `${this.path}.corrupt-${Date.now()}`;
        try {
          await rename(this.path, corruptPath);
        } catch {
          // Keep going: a new safe config can still be written.
        }
        this.#config = validateConfig(createDefaultConfig());
        this.#recoveryNotice = `Started with a clean configuration; existing files were unreadable (${errorMessage(primaryError)}; backup: ${errorMessage(backupError)})`;
        await this.#atomicWrite(this.#config, { createBackup: false });
        return this.get();
      }
    }
  }

  get() {
    if (!this.#config) {
      throw new Error("ConfigStore has not been initialized");
    }
    return jsonClone(this.#config);
  }

  async replace(nextConfig, expectedRevision) {
    return this.#enqueue(async () => {
      const current = this.get();
      if (expectedRevision !== current.revision) {
        throw new RevisionConflictError(expectedRevision, current.revision);
      }
      const candidate = validateConfig({
        ...nextConfig,
        revision: current.revision + 1,
      });
      await this.#atomicWrite(candidate);
      this.#config = candidate;
      return this.get();
    });
  }

  async update(mutator, expectedRevision = this.get().revision) {
    const draft = this.get();
    await mutator(draft);
    return this.replace(draft, expectedRevision);
  }

  #enqueue(operation) {
    const next = this.#queue.then(operation, operation);
    this.#queue = next.catch(() => undefined);
    return next;
  }

  async #atomicWrite(config, { createBackup = true } = {}) {
    const data = `${JSON.stringify(config, null, 2)}\n`;
    if (Buffer.byteLength(data, "utf8") > MAX_CONFIG_BYTES) {
      throw new Error("Configuration exceeds the 5 MB safety limit");
    }

    const nonce = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const temporaryPath = join(dirname(this.path), `.${nonce}.tmp`);
    const backupTemporaryPath = join(dirname(this.path), `.${nonce}.bak.tmp`);
    let handle;
    let backupHandle;
    try {
      if (createBackup && (await exists(this.path))) {
        const currentData = await readFile(this.path);
        backupHandle = await open(backupTemporaryPath, "wx", 0o600);
        await backupHandle.writeFile(currentData);
        await backupHandle.sync();
        await backupHandle.close();
        backupHandle = null;
        await rename(backupTemporaryPath, this.backupPath);
        await fsyncDirectory(this.directory);
      }
      handle = await open(temporaryPath, "wx", 0o600);
      await handle.writeFile(data, "utf8");
      await handle.sync();
      await handle.close();
      handle = null;
      await rename(temporaryPath, this.path);
      await fsyncDirectory(this.directory);
    } finally {
      await handle?.close();
      await backupHandle?.close();
      await unlink(temporaryPath).catch(() => undefined);
      await unlink(backupTemporaryPath).catch(() => undefined);
    }
  }
}
