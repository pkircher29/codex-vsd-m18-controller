import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join, win32 } from "node:path";

export function dataDirectory(env = process.env, platform = process.platform, home = homedir()) {
  if (env.VSD_M18_DATA_HOME) return env.VSD_M18_DATA_HOME;
  if (platform === "win32") {
    const profile = env.USERPROFILE || home;
    const root = env.LOCALAPPDATA || win32.join(profile, "AppData", "Local");
    return win32.join(root, "M18Foundry");
  }
  const root = env.XDG_DATA_HOME || join(home, ".local", "share");
  return join(root, "vsd-m18-controller");
}

export function configDirectory(env = process.env, platform = process.platform, home = homedir()) {
  if (env.VSD_M18_CONFIG_HOME) return env.VSD_M18_CONFIG_HOME;
  if (platform === "win32") {
    const profile = env.USERPROFILE || home;
    const root = env.APPDATA || win32.join(profile, "AppData", "Roaming");
    return win32.join(root, "M18Foundry");
  }
  const root = env.XDG_CONFIG_HOME || join(home, ".config");
  return join(root, "vsd-m18-controller");
}

export function runtimeDirectory(env = process.env, platform = process.platform, home = homedir()) {
  if (env.VSD_M18_RUNTIME_HOME) return env.VSD_M18_RUNTIME_HOME;
  if (platform === "win32") {
    const profile = env.USERPROFILE || home;
    const root = env.LOCALAPPDATA || win32.join(profile, "AppData", "Local");
    return win32.join(root, "M18Foundry", "runtime");
  }
  if (env.XDG_RUNTIME_DIR) return join(env.XDG_RUNTIME_DIR, "vsd-m18-controller");
  return join(configDirectory(env, platform, home), "runtime");
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
