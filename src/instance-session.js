import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { runtimeDirectory } from "./util.js";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function validateDescriptor(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.version !== 1 || !TOKEN_PATTERN.test(value.token || "")) return null;
  if (!new Set(["127.0.0.1", "localhost", "::1"]).has(value.host)) return null;
  if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65_535) return null;
  if (!Number.isInteger(value.pid) || value.pid < 1) return null;
  return {
    version: 1,
    token: value.token,
    host: value.host,
    port: value.port,
    pid: value.pid,
    startedAt: typeof value.startedAt === "string" ? value.startedAt : null,
  };
}

export function createInstanceToken() {
  return randomBytes(32).toString("base64url");
}

export function instanceTokensEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function instanceBaseUrl(descriptor) {
  const host = descriptor.host === "::1" ? "[::1]" : descriptor.host;
  return `http://${host}:${descriptor.port}`;
}

export function instanceUiUrl(descriptor) {
  return `${instanceBaseUrl(descriptor)}/?instance=${encodeURIComponent(descriptor.token)}`;
}

export async function readInstanceDescriptor({ directory = runtimeDirectory() } = {}) {
  try {
    return validateDescriptor(JSON.parse(await readFile(join(directory, "instance.json"), "utf8")));
  } catch {
    return null;
  }
}

export class InstanceSession {
  constructor({ directory = runtimeDirectory(), token = createInstanceToken() } = {}) {
    if (!TOKEN_PATTERN.test(token)) throw new TypeError("Invalid M18 instance token");
    this.directory = directory;
    this.path = join(directory, "instance.json");
    this.lockPath = join(directory, "controller.lock");
    this.token = token;
  }

  async acquire() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let handle;
      try {
        handle = await open(this.lockPath, "wx", 0o600);
        await handle.writeFile(
          `${JSON.stringify({ pid: process.pid, token: this.token, startedAt: new Date().toISOString() })}\n`,
          "utf8",
        );
        await handle.sync();
        await handle.close();
        return true;
      } catch (error) {
        await handle?.close();
        if (error.code !== "EEXIST") throw error;
        let owner;
        try {
          owner = JSON.parse(await readFile(this.lockPath, "utf8"));
        } catch {
          owner = null;
        }
        if (owner?.pid && this.#processExists(owner.pid)) return false;
        await unlink(this.lockPath).catch(() => undefined);
      }
    }
    return false;
  }

  async publish({ host, port, pid = process.pid }) {
    const descriptor = validateDescriptor({
      version: 1,
      token: this.token,
      host,
      port,
      pid,
      startedAt: new Date().toISOString(),
    });
    if (!descriptor) throw new TypeError("Invalid M18 instance descriptor");
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporaryPath = join(
      this.directory,
      `.instance-${process.pid}-${Date.now()}-${randomBytes(6).toString("hex")}.tmp`,
    );
    let handle;
    try {
      handle = await open(temporaryPath, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(descriptor, null, 2)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      handle = null;
      await rename(temporaryPath, this.path);
    } finally {
      await handle?.close();
      await unlink(temporaryPath).catch(() => undefined);
    }
    return descriptor;
  }

  async clear() {
    const current = await readInstanceDescriptor({ directory: this.directory });
    if (current && instanceTokensEqual(current.token, this.token)) {
      await unlink(this.path).catch(() => undefined);
    }
    let lock;
    try {
      lock = JSON.parse(await readFile(this.lockPath, "utf8"));
    } catch {
      lock = null;
    }
    if (lock && instanceTokensEqual(lock.token, this.token)) {
      await unlink(this.lockPath).catch(() => undefined);
    }
  }

  #processExists(pid) {
    if (!Number.isInteger(pid) || pid < 1) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return error.code === "EPERM";
    }
  }
}
