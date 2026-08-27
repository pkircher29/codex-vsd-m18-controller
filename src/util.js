import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

export function dataDirectory(env = process.env) {
  const root = env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return join(root, "vsd-m18-controller");
}

export function configDirectory(env = process.env) {
  const root = env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(root, "vsd-m18-controller");
}

export function runtimeDirectory(env = process.env) {
  const root = env.XDG_RUNTIME_DIR || join("/tmp", `vsd-m18-${process.getuid?.() ?? "user"}`);
  return join(root, "controller");
}

export function createId(prefix) {
  return `${prefix}-${randomUUID()}`;
}

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function canonicalJsonValue(value) {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalJsonValue(child)]),
    );
  }
  return value;
}

export function jsonFingerprint(value) {
  return sha256(Buffer.from(JSON.stringify(canonicalJsonValue(value)), "utf8"));
}

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function jsonClone(value) {
  return structuredClone(value);
}

export function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
