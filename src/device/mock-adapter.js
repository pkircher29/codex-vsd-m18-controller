import EventEmitter from "node:events";

export class MockM18Adapter extends EventEmitter {
  constructor() {
    super();
    this.operations = [];
    this.images = new Map();
    this.brightness = 72;
    this.ledColor = "#E59B3A";
  }

  get identity() {
    return {
      model: "M18 Simulator",
      vendorId: 0x5548,
      productId: 0x1000,
      serialNumber: "SIM-M18-0001",
      path: "mock://vsd-m18",
      simulated: true,
    };
  }

  async start() {
    this.operations.push({ type: "start", at: Date.now() });
  }

  async wake() {
    this.operations.push({ type: "wake", at: Date.now() });
  }

  async setBrightness(value) {
    this.brightness = value;
    this.operations.push({ type: "brightness", value, at: Date.now() });
  }

  async setLedColor(color) {
    this.ledColor = color;
    this.operations.push({ type: "led", color, at: Date.now() });
  }

  async clearAll() {
    this.images.clear();
    this.operations.push({ type: "clearAll", at: Date.now() });
  }

  async clearKey(logicalKey) {
    this.images.delete(logicalKey);
    this.operations.push({ type: "clearKey", key: logicalKey, at: Date.now() });
  }

  async setKeyImage(logicalKey, jpeg) {
    this.images.set(logicalKey, Buffer.from(jpeg));
    this.operations.push({ type: "image", key: logicalKey, bytes: jpeg.length, at: Date.now() });
  }

  async refresh() {
    this.operations.push({ type: "refresh", at: Date.now() });
  }

  async applyProfile({ images, brightness, ledColor, onProgress }) {
    await this.wake();
    await this.setBrightness(brightness);
    await this.setLedColor(ledColor);
    await this.clearAll();
    for (const [index, image] of images.entries()) {
      await this.setKeyImage(image.key, image.jpeg);
      onProgress?.(index + 1, images.length);
    }
    await this.refresh();
  }

  async close() {
    this.operations.push({ type: "close", at: Date.now() });
  }

  press(key, pressed = true, context = {}) {
    this.emit("input", {
      key,
      pressed,
      hardwareCode: key,
      rawState: pressed ? 1 : 0,
      ...context,
      simulated: true,
    });
  }
}
