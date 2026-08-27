import assert from "node:assert/strict";
import EventEmitter from "node:events";
import test from "node:test";
import sharp from "sharp";
import { HidM18Adapter } from "../src/device/hid-adapter.js";
import {
  buildBrightnessPacket,
  buildImageHeader,
  buildImagePackets,
  decodeInputReport,
  hardwareKeyToLogical,
  logicalKeyToHardware,
  renderKeyJpeg,
} from "../src/device/protocol.js";

test("logical and hardware M18 key mappings match the physical rows", () => {
  assert.deepEqual(
    Array.from({ length: 18 }, (_, index) => logicalKeyToHardware(index + 1)),
    [11, 12, 13, 14, 15, 6, 7, 8, 9, 10, 1, 2, 3, 4, 5, 0x25, 0x30, 0x31],
  );
  assert.equal(hardwareKeyToLogical(11), 1);
  assert.equal(hardwareKeyToLogical(1), 11);
  assert.equal(hardwareKeyToLogical(0x30), 17);
  assert.equal(hardwareKeyToLogical(0xff), null);
});

test("command and image packets have exact HID framing", () => {
  const brightness = buildBrightnessPacket(73);
  assert.equal(brightness.length, 1025);
  assert.equal(brightness.subarray(0, 9).toString("hex"), "0043525400004c4947");
  assert.deepEqual([...brightness.subarray(9, 12)], [0, 0, 73]);

  const header = buildImageHeader(0x1234, 1);
  assert.equal(header.length, 1025);
  assert.equal(header.subarray(1, 9).toString("binary"), "CRT\0\0BAT");
  assert.equal(header.readUInt32BE(9), 0x1234);
  assert.equal(header[13], 11);

  const chunks = buildImagePackets(Buffer.alloc(1_500, 0x7a));
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].length, 1025);
  assert.equal(chunks[1][1], 0x7a);
  assert.equal(chunks[1][476], 0x7a);
  assert.equal(chunks[1][477], 0x00);
});

test("input reports require the full ACK/OK prefix and decode press state", () => {
  const report = Buffer.alloc(512);
  Buffer.from([0x41, 0x43, 0x4b, 0, 0, 0x4f, 0x4b, 0, 0, 0x0b, 1]).copy(report);
  assert.deepEqual(decodeInputReport(report), {
    key: 1,
    pressed: true,
    hardwareCode: 11,
    rawState: 1,
  });
  report[5] = 0x00;
  assert.equal(decodeInputReport(report), null);
});

test("rendered LCD artwork is native 64x64 JPEG with a JFIF APP0 marker", async () => {
  const jpeg = await renderKeyJpeg(
    { index: 1, label: "MIC", color: "#C47A32", assetId: null },
    { pathFor() {} },
  );
  assert.ok(jpeg.length < 10_240);
  assert.equal(jpeg.subarray(0, 4).toString("hex"), "ffd8ffe0");
  assert.equal(jpeg.subarray(6, 11).toString("binary"), "JFIF\0");
  const metadata = await sharp(jpeg).metadata();
  assert.equal(metadata.width, 64);
  assert.equal(metadata.height, 64);
});

class RecordingHandle extends EventEmitter {
  constructor() {
    super();
    this.writes = [];
    this.active = 0;
    this.maxActive = 0;
    this.closed = false;
  }

  async write(packet) {
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    await new Promise((resolve) => setImmediate(resolve));
    this.writes.push(Buffer.from(packet));
    this.active -= 1;
    return packet.length;
  }

  async close() {
    this.closed = true;
  }
}

test("HID adapter serializes a complete profile and respects EOI commit firmware", async () => {
  const handle = new RecordingHandle();
  const adapter = new HidM18Adapter({
    handle,
    info: { path: "/dev/test", serialNumber: "test" },
    definition: {
      model: "test",
      vendorId: 0x6603,
      productId: 0x1012,
      packetSize: 1024,
      keyImageCommit: "eoi",
    },
  });
  await adapter.start();
  const progress = [];
  await adapter.applyProfile({
    images: [
      { key: 1, jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) },
      { key: 2, jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) },
    ],
    brightness: 50,
    ledColor: "#112233",
    onProgress: (current) => progress.push(current),
  });
  await adapter.close();
  assert.equal(handle.maxActive, 1);
  assert.deepEqual(progress, [1, 2]);
  assert.equal(handle.writes.length, 10);
  assert.equal(handle.writes.at(-1).subarray(1, 4).toString("hex"), "ffd8ff");
  assert.equal(handle.closed, true);
});
