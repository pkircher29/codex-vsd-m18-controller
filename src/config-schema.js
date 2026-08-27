import {
  CONFIG_SCHEMA_VERSION,
  DEFAULT_KEY_COLORS,
  KEY_COUNT,
  LCD_KEY_COUNT,
} from "./constants.js";
import { clamp, createId, jsonClone } from "./util.js";

const ACTION_TYPES = new Set(["none", "command", "url", "profile"]);
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

function expectObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function cleanString(value, label, maximum = 128, { allowEmpty = true, trim = true } = {}) {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be text`);
  }
  const clean = trim ? value.trim() : value;
  if (!allowEmpty && clean.trim().length === 0) {
    throw new TypeError(`${label} cannot be empty`);
  }
  if (clean.length > maximum || clean.includes("\0")) {
    throw new TypeError(`${label} is too long or contains an invalid character`);
  }
  return clean;
}

function cleanId(value, label) {
  const id = cleanString(value, label, 128, { allowEmpty: false });
  if (!SAFE_ID.test(id)) {
    throw new TypeError(`${label} contains unsupported characters`);
  }
  return id;
}

function cleanColor(value, label) {
  const color = cleanString(value, label, 7, { allowEmpty: false }).toUpperCase();
  if (!HEX_COLOR.test(color)) {
    throw new TypeError(`${label} must be a six-digit hex color`);
  }
  return color;
}

function cleanAction(raw, label) {
  const action = expectObject(raw, label);
  const type = cleanString(action.type, `${label}.type`, 16, { allowEmpty: false });
  if (!ACTION_TYPES.has(type)) {
    throw new TypeError(`${label}.type is not supported`);
  }

  if (type === "command") {
    const executable = cleanString(action.executable, `${label}.executable`, 1024, {
      allowEmpty: false,
      trim: false,
    });
    const rawArgs = action.args ?? [];
    if (!Array.isArray(rawArgs) || rawArgs.length > 64) {
      throw new TypeError(`${label}.args must contain at most 64 arguments`);
    }
    const args = rawArgs.map((arg, index) =>
      cleanString(arg, `${label}.args[${index}]`, 2048, { trim: false }),
    );
    return { type, executable, args };
  }

  if (type === "url") {
    const url = cleanString(action.url, `${label}.url`, 4096, { allowEmpty: false });
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new TypeError(`${label}.url must be a valid URL`);
    }
    if (!new Set(["http:", "https:"]).has(parsed.protocol)) {
      throw new TypeError(`${label}.url must use http or https`);
    }
    return { type, url: parsed.toString() };
  }

  if (type === "profile") {
    return { type, profileId: cleanId(action.profileId, `${label}.profileId`) };
  }

  return { type: "none" };
}

function cleanKey(raw, expectedIndex, label) {
  const key = expectObject(raw, label);
  const index = Number(key.index);
  if (!Number.isInteger(index) || index !== expectedIndex) {
    throw new TypeError(`${label}.index must be ${expectedIndex}`);
  }
  const assetId = key.assetId == null ? null : cleanId(key.assetId, `${label}.assetId`);
  if (expectedIndex > LCD_KEY_COUNT && assetId) {
    throw new TypeError(`${label}.assetId is only valid for LCD keys 1-${LCD_KEY_COUNT}`);
  }
  return {
    index,
    label: cleanString(key.label ?? "", `${label}.label`, 32),
    color: cleanColor(key.color, `${label}.color`),
    assetId,
    action: cleanAction(key.action ?? { type: "none" }, `${label}.action`),
  };
}

function cleanProfile(raw, index) {
  const label = `profiles[${index}]`;
  const profile = expectObject(raw, label);
  if (!Array.isArray(profile.keys) || profile.keys.length !== KEY_COUNT) {
    throw new TypeError(`${label}.keys must contain exactly ${KEY_COUNT} entries`);
  }
  return {
    id: cleanId(profile.id, `${label}.id`),
    name: cleanString(profile.name, `${label}.name`, 64, { allowEmpty: false }),
    keys: profile.keys.map((key, keyIndex) => cleanKey(key, keyIndex + 1, `${label}.keys[${keyIndex}]`)),
  };
}

export function validateConfig(raw) {
  const config = expectObject(jsonClone(raw), "config");
  if (config.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    throw new TypeError(`Unsupported config schema version: ${config.schemaVersion}`);
  }
  if (!Number.isInteger(config.revision) || config.revision < 0) {
    throw new TypeError("config.revision must be a non-negative integer");
  }
  if (!Array.isArray(config.profiles) || config.profiles.length < 1 || config.profiles.length > 50) {
    throw new TypeError("config.profiles must contain between 1 and 50 profiles");
  }

  const profiles = config.profiles.map(cleanProfile);
  const ids = new Set(profiles.map((profile) => profile.id));
  if (ids.size !== profiles.length) {
    throw new TypeError("Profile IDs must be unique");
  }
  const activeProfileId = cleanId(config.activeProfileId, "config.activeProfileId");
  if (!ids.has(activeProfileId)) {
    throw new TypeError("config.activeProfileId does not identify a profile");
  }

  for (const profile of profiles) {
    for (const key of profile.keys) {
      if (key.action.type === "profile" && !ids.has(key.action.profileId)) {
        throw new TypeError(
          `Profile ${profile.name}, key ${key.index} points to a profile that does not exist`,
        );
      }
    }
  }

  const device = expectObject(config.device, "config.device");
  const brightness = Number(device.brightness);
  if (!Number.isFinite(brightness)) {
    throw new TypeError("config.device.brightness must be a number from 0 to 100");
  }
  if (typeof device.autoApply !== "boolean") {
    throw new TypeError("config.device.autoApply must be true or false");
  }
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    revision: config.revision,
    activeProfileId,
    device: {
      brightness: clamp(Math.round(brightness), 0, 100),
      ledColor: cleanColor(device.ledColor, "config.device.ledColor"),
      autoApply: device.autoApply,
    },
    profiles,
  };
}

export function createBlankProfile(name = "Main") {
  const id = createId("profile");
  return {
    id,
    name,
    keys: Array.from({ length: KEY_COUNT }, (_, offset) => ({
      index: offset + 1,
      label: offset < LCD_KEY_COUNT ? `KEY ${offset + 1}` : ["BACK", "HOME", "NEXT"][offset - LCD_KEY_COUNT],
      color: DEFAULT_KEY_COLORS[offset % DEFAULT_KEY_COLORS.length],
      assetId: null,
      action: { type: "none" },
    })),
  };
}

export function createDefaultConfig() {
  const profile = createBlankProfile();
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    revision: 0,
    activeProfileId: profile.id,
    device: {
      brightness: 72,
      ledColor: "#E59B3A",
      autoApply: false,
    },
    profiles: [profile],
  };
}

export function cloneProfile(profile, name = `${profile.name} Copy`) {
  const copy = jsonClone(profile);
  copy.id = createId("profile");
  copy.name = name;
  return copy;
}
