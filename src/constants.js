export const APP_NAME = "M18 Foundry";
export const APP_VERSION = "0.1.0";
export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 0;
export const KEY_COUNT = 18;
export const LCD_KEY_COUNT = 15;
export const LED_COUNT = 24;
export const CONFIG_SCHEMA_VERSION = 1;
export const MAX_CONFIG_BYTES = 5 * 1024 * 1024;
export const MAX_ASSET_BYTES = 2 * 1024 * 1024;

export const SUPPORTED_DEVICES = Object.freeze([
  {
    vendorId: 0x5548,
    productId: 0x1000,
    model: "VSDinside M18",
    protocolVersion: 3,
    packetSize: 1024,
    keyImageCommit: "stp",
  },
  {
    vendorId: 0x6603,
    productId: 0x1009,
    model: "Mirabox M18",
    protocolVersion: 3,
    packetSize: 1024,
    keyImageCommit: "stp",
  },
  {
    vendorId: 0x6603,
    productId: 0x1012,
    model: "Mirabox M18 EN",
    protocolVersion: 3,
    packetSize: 1024,
    keyImageCommit: "eoi",
  },
]);

export const DEFAULT_KEY_COLORS = Object.freeze([
  "#C47A32",
  "#7D8F6A",
  "#9B665D",
  "#6F7F83",
  "#A28B53",
  "#806F94",
]);

export const PAGE_NAVIGATION_KEYS = Object.freeze([
  Object.freeze({ index: 16, label: "BACK", target: "previous" }),
  Object.freeze({ index: 17, label: "HOME", target: "first" }),
  Object.freeze({ index: 18, label: "NEXT", target: "next" }),
]);
