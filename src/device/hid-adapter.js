import EventEmitter from "node:events";
import {
  buildBrightnessPacket,
  buildClearAllPacket,
  buildClearKeyPacket,
  buildHeartbeatPacket,
  buildImageHeader,
  buildImagePackets,
  buildLedColorPacket,
  buildRefreshPacket,
  buildWakePacket,
  decodeInputReport,
} from "./protocol.js";

export class HidM18Adapter extends EventEmitter {
  #closed = false;
  #heartbeat = null;
  #keyStates = new Map();
  #writeQueue = Promise.resolve();

  constructor({ handle, info, definition }) {
    super();
    this.handle = handle;
    this.info = info;
    this.definition = definition;
    this.packetSize = definition.packetSize;
    handle.on("data", (report) => this.#onData(report));
    handle.on("error", (error) => this.emit("error", error));
  }

  get identity() {
    return {
      model: this.definition.model,
      vendorId: this.definition.vendorId,
      productId: this.definition.productId,
      serialNumber: this.info.serialNumber || "unknown",
      path: this.info.path,
      simulated: false,
    };
  }

  async start() {
    await this.write(buildHeartbeatPacket(this.packetSize));
    this.#heartbeat = setInterval(() => {
      this.write(buildHeartbeatPacket(this.packetSize)).catch((error) => this.emit("error", error));
    }, 8_000);
    this.#heartbeat.unref?.();
  }

  write(packet) {
    if (this.#closed) return Promise.reject(new Error("M18 device is closed"));
    return this.#enqueueWrite(() => this.#writePacket(packet));
  }

  #enqueueWrite(operation) {
    const queued = this.#writeQueue.then(operation, operation);
    this.#writeQueue = queued.catch(() => undefined);
    return queued;
  }

  async #writePacket(packet) {
    const written = await this.handle.write(packet);
    if (typeof written === "number" && written < packet.length - 1) {
      throw new Error(`Short HID write: ${written}/${packet.length - 1} bytes`);
    }
  }

  async wake() {
    await this.write(buildWakePacket(this.packetSize));
  }

  async setBrightness(value) {
    await this.write(buildBrightnessPacket(value, this.packetSize));
  }

  async setLedColor(color) {
    await this.write(buildLedColorPacket(color, this.packetSize));
  }

  async clearAll() {
    await this.#enqueueWrite(async () => {
      await this.#writePacket(buildClearAllPacket(this.packetSize));
      await this.#writePacket(buildRefreshPacket(this.packetSize));
    });
  }

  async clearKey(logicalKey) {
    await this.write(buildClearKeyPacket(logicalKey, this.packetSize));
  }

  async setKeyImage(logicalKey, jpeg) {
    await this.#enqueueWrite(() => this.#writeImage(logicalKey, jpeg));
  }

  async refresh() {
    await this.write(buildRefreshPacket(this.packetSize));
  }

  async applyProfile({ images, brightness, ledColor, onProgress }) {
    await this.#enqueueWrite(async () => {
      await this.#writePacket(buildWakePacket(this.packetSize));
      await this.#writePacket(buildBrightnessPacket(brightness, this.packetSize));
      await this.#writePacket(buildLedColorPacket(ledColor, this.packetSize));
      await this.#writePacket(buildClearAllPacket(this.packetSize));
      await this.#writePacket(buildRefreshPacket(this.packetSize));
      for (const [index, image] of images.entries()) {
        await this.#writeImage(image.key, image.jpeg);
        onProgress?.(index + 1, images.length);
      }
      if (this.definition.keyImageCommit !== "eoi") {
        await this.#writePacket(buildRefreshPacket(this.packetSize));
      }
    });
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    clearInterval(this.#heartbeat);
    await this.#writeQueue.catch(() => undefined);
    await this.handle.close();
  }

  #onData(report) {
    const event = decodeInputReport(report);
    if (!event) return;
    if (this.#keyStates.get(event.key) === event.pressed) return;
    this.#keyStates.set(event.key, event.pressed);
    this.emit("input", event);
  }

  async #writeImage(logicalKey, jpeg) {
    await this.#writePacket(buildImageHeader(jpeg.length, logicalKey, this.packetSize));
    for (const packet of buildImagePackets(jpeg, this.packetSize)) {
      await this.#writePacket(packet);
    }
  }
}
