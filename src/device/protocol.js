import sharp from "sharp";
import { LCD_KEY_COUNT, LED_COUNT } from "../constants.js";
import { clamp } from "../util.js";

const COMMAND_PREFIX = Buffer.from([0x43, 0x52, 0x54, 0x00, 0x00]);
const INPUT_PREFIX = Buffer.from([0x41, 0x43, 0x4b, 0x00, 0x00, 0x4f, 0x4b, 0x00, 0x00]);
const BOTTOM_HARDWARE_CODES = new Map([
  [16, 0x25],
  [17, 0x30],
  [18, 0x31],
]);
const JFIF_APP0 = Buffer.from([
  0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00,
  0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
]);

function byteString(value) {
  return Buffer.from(value, "ascii");
}

function parseColor(color) {
  if (!/^#[0-9a-f]{6}$/i.test(color)) {
    throw new TypeError("LED color must be a six-digit hex value");
  }
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
}

function contrastTextColor(color) {
  const [red, green, blue] = parseColor(color).map((channel) => channel / 255);
  const linear = [red, green, blue].map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  return luminance > 0.179 ? "#000000" : "#ffffff";
}

export function logicalKeyToHardware(logicalKey) {
  if (!Number.isInteger(logicalKey) || logicalKey < 1 || logicalKey > 18) {
    throw new RangeError("M18 key index must be between 1 and 18");
  }
  if (logicalKey > LCD_KEY_COUNT) {
    return BOTTOM_HARDWARE_CODES.get(logicalKey);
  }
  const row = Math.floor((logicalKey - 1) / 5);
  const column = (logicalKey - 1) % 5;
  return (2 - row) * 5 + column + 1;
}

export function hardwareKeyToLogical(hardwareCode) {
  for (const [logical, hardware] of BOTTOM_HARDWARE_CODES) {
    if (hardware === hardwareCode) return logical;
  }
  if (hardwareCode < 1 || hardwareCode > 15) return null;
  const row = Math.floor((hardwareCode - 1) / 5);
  const column = (hardwareCode - 1) % 5;
  return (2 - row) * 5 + column + 1;
}

export function buildCommandPacket(command, payload = Buffer.alloc(0), packetSize = 1024) {
  const commandBytes = Buffer.isBuffer(command) ? command : byteString(command);
  const payloadBytes = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const bodyLength = COMMAND_PREFIX.length + commandBytes.length + payloadBytes.length;
  if (bodyLength > packetSize) {
    throw new RangeError(`Command payload is ${bodyLength} bytes; packet limit is ${packetSize}`);
  }
  const packet = Buffer.alloc(packetSize + 1);
  packet[0] = 0x00;
  COMMAND_PREFIX.copy(packet, 1);
  commandBytes.copy(packet, 1 + COMMAND_PREFIX.length);
  payloadBytes.copy(packet, 1 + COMMAND_PREFIX.length + commandBytes.length);
  return packet;
}

export function buildImageHeader(imageLength, logicalKey, packetSize = 1024) {
  if (!Number.isInteger(imageLength) || imageLength < 1 || imageLength > 10240) {
    throw new RangeError("M18 JPEG payload must contain 1-10240 bytes");
  }
  const payload = Buffer.alloc(5);
  payload.writeUInt32BE(imageLength, 0);
  payload[4] = logicalKeyToHardware(logicalKey);
  return buildCommandPacket("BAT", payload, packetSize);
}

export function buildImagePackets(image, packetSize = 1024) {
  if (!Buffer.isBuffer(image)) {
    throw new TypeError("M18 image payload must be a Buffer");
  }
  const packets = [];
  for (let offset = 0; offset < image.length; offset += packetSize) {
    const packet = Buffer.alloc(packetSize + 1);
    packet[0] = 0x00;
    image.copy(packet, 1, offset, Math.min(offset + packetSize, image.length));
    packets.push(packet);
  }
  return packets;
}

export function buildBrightnessPacket(value, packetSize = 1024) {
  return buildCommandPacket("LIG", Buffer.from([0x00, 0x00, clamp(Math.round(value), 0, 100)]), packetSize);
}

export function buildLedColorPacket(color, packetSize = 1024) {
  const rgb = parseColor(color);
  return buildCommandPacket("SETLB", Buffer.from(Array.from({ length: LED_COUNT }, () => rgb).flat()), packetSize);
}

export function buildWakePacket(packetSize = 1024) {
  return buildCommandPacket("DIS", Buffer.alloc(0), packetSize);
}

export function buildRefreshPacket(packetSize = 1024) {
  return buildCommandPacket("STP", Buffer.alloc(0), packetSize);
}

export function buildClearAllPacket(packetSize = 1024) {
  return buildCommandPacket("CLE", Buffer.from([0x00, 0x00, 0x00, 0xff]), packetSize);
}

export function buildClearKeyPacket(logicalKey, packetSize = 1024) {
  return buildCommandPacket(
    "CLE",
    Buffer.from([0x00, 0x00, 0x00, logicalKeyToHardware(logicalKey)]),
    packetSize,
  );
}

export function buildHeartbeatPacket(packetSize = 1024) {
  return buildCommandPacket("CONNECT", Buffer.alloc(0), packetSize);
}

export function decodeInputReport(report) {
  if (!Buffer.isBuffer(report) || report.length < 11 || !report.subarray(0, 9).equals(INPUT_PREFIX)) {
    return null;
  }
  const key = hardwareKeyToLogical(report[9]);
  if (!key) return null;
  return {
    key,
    pressed: report[10] === 0x01,
    hardwareCode: report[9],
    rawState: report[10],
  };
}

function escapeXml(value) {
  return value.replace(/[<>&"']/g, (character) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    '"': "&quot;",
    "'": "&apos;",
  })[character]);
}

export function ensureJfifApp0(jpeg) {
  if (!Buffer.isBuffer(jpeg) || jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
    throw new TypeError("Key artwork is not a JPEG stream");
  }
  if (
    jpeg[2] === 0xff &&
    jpeg[3] === 0xe0 &&
    jpeg.subarray(6, 11).equals(Buffer.from("JFIF\0", "binary"))
  ) {
    return jpeg;
  }
  return Buffer.concat([jpeg.subarray(0, 2), JFIF_APP0, jpeg.subarray(2)]);
}

function labelSvg(label, color, hasArtwork) {
  const visible = label.trim().slice(0, 16).toUpperCase();
  const fontSize = visible.length > 10 ? 8 : visible.length > 6 ? 9 : 11;
  const baseline = hasArtwork ? 58 : 36;
  const background = hasArtwork
    ? '<rect x="0" y="45" width="64" height="19" fill="#0b0c0a" fill-opacity="0.82"/>'
    : `<rect width="64" height="64" rx="8" fill="${color}"/><path d="M8 9h48M8 55h48" stroke="#fff" stroke-opacity=".18"/>`;
  const textColor = hasArtwork ? "#fffaf0" : contrastTextColor(color);
  return Buffer.from(`
    <svg width="64" height="64" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      ${background}
      <text x="32" y="${baseline}" text-anchor="middle" fill="${textColor}"
        font-family="DejaVu Sans, sans-serif" font-size="${fontSize}" font-weight="700"
        letter-spacing=".4">${escapeXml(visible || "UNSET")}</text>
    </svg>
  `);
}

export async function renderKeyJpeg(key, assetStore) {
  let pipeline;
  if (key.assetId) {
    pipeline = sharp(assetStore.pathFor(key.assetId), {
      animated: false,
      limitInputPixels: 40_000_000,
    })
      .resize(64, 64, { fit: "cover", position: "attention" })
      .composite([{ input: labelSvg(key.label, key.color, true), top: 0, left: 0 }]);
  } else {
    pipeline = sharp(labelSvg(key.label, key.color, false));
  }

  for (const quality of [92, 82, 72, 62, 52]) {
    const encoded = await pipeline
      .clone()
      .flatten({ background: key.color })
      .jpeg({ quality, chromaSubsampling: "4:2:0", mozjpeg: true })
      .toBuffer();
    const jpeg = ensureJfifApp0(encoded);
    if (jpeg.length <= 10240) return jpeg;
  }
  throw new Error(`Key ${key.index} image could not be compressed below 10 KB`);
}
