import { spawn } from "node:child_process";
import EventEmitter from "node:events";
import { SUPPORTED_DEVICES } from "../constants.js";
import { errorMessage } from "../util.js";
import { HidM18Adapter } from "./hid-adapter.js";
import { MockM18Adapter } from "./mock-adapter.js";

function definitionFor(info) {
  return SUPPORTED_DEVICES.find(
    (device) => device.vendorId === info.vendorId && device.productId === info.productId,
  );
}

function isControlInterface(info) {
  if (info.usagePage != null && info.usage != null) {
    return info.usagePage === 0xffa0 && info.usage === 0x01;
  }
  return info.interface === 0 || info.interface == null;
}

function permissionFailure(error) {
  return /permission|access denied|cannot open device|eacces/i.test(errorMessage(error));
}

export class DeviceManager extends EventEmitter {
  #mode;
  #adapter = null;
  #scanPromise = null;
  #udevMonitor = null;
  #rescanTimer = null;
  #reconcileTimer = null;
  #stopped = false;

  constructor({ mode = process.env.VSD_M18_MODE || "auto" } = {}) {
    super();
    if (!new Set(["auto", "real", "mock"]).has(mode)) {
      throw new TypeError("VSD_M18_MODE must be auto, real, or mock");
    }
    this.#mode = mode;
    this.status = {
      state: "starting",
      message: "Inspecting USB devices…",
      device: null,
      mode,
    };
  }

  get adapter() {
    return this.#adapter;
  }

  async start() {
    if (this.#mode === "mock") {
      const adapter = new MockM18Adapter();
      await this.#attach(adapter);
      return;
    }
    await this.scan();
    this.#startUdevMonitor();
    this.#reconcileTimer = setInterval(() => this.scan().catch(() => undefined), 60_000);
    this.#reconcileTimer.unref?.();
  }

  async scan() {
    if (this.#stopped) return;
    if (this.#scanPromise) return this.#scanPromise;
    this.#scanPromise = this.#scanRealDevices().finally(() => {
      this.#scanPromise = null;
    });
    return this.#scanPromise;
  }

  async stop() {
    this.#stopped = true;
    clearTimeout(this.#rescanTimer);
    clearInterval(this.#reconcileTimer);
    this.#udevMonitor?.kill();
    this.#udevMonitor = null;
    const adapter = this.#adapter;
    this.#adapter = null;
    await adapter?.close().catch(() => undefined);
  }

  simulatePress(key, context = {}) {
    if (!(this.#adapter instanceof MockM18Adapter)) {
      throw new Error("Simulated presses are available only in simulator mode");
    }
    this.#adapter.press(key, true, context);
    queueMicrotask(() => this.#adapter?.press(key, false, context));
  }

  async #scanRealDevices() {
    let hid;
    try {
      hid = await import("node-hid");
    } catch (error) {
      this.#setStatus("error", `The HID driver could not load: ${errorMessage(error)}`);
      return;
    }

    let devices;
    try {
      devices = await hid.devicesAsync();
    } catch (error) {
      this.#setStatus("error", `USB enumeration failed: ${errorMessage(error)}`);
      return;
    }

    const candidate = devices.find((info) => definitionFor(info) && isControlInterface(info));
    if (!candidate) {
      if (this.#adapter) await this.#detach();
      this.#setStatus("disconnected", "No supported M18 is connected");
      return;
    }

    if (this.#adapter?.identity.path === candidate.path) return;
    if (this.#adapter) await this.#detach();

    const definition = definitionFor(candidate);
    try {
      const handle = await hid.HIDAsync.open(candidate.path);
      await this.#attach(new HidM18Adapter({ handle, info: candidate, definition }));
    } catch (error) {
      if (this.#adapter) await this.#detach();
      const message = errorMessage(error);
      this.#setStatus(
        permissionFailure(error) ? "permission" : "error",
        permissionFailure(error)
          ? "M18 found, but Linux has not granted hidraw access. Run the included Linux installer, then reconnect the dock."
          : `M18 found but could not be opened: ${message}`,
        {
          model: definition.model,
          vendorId: definition.vendorId,
          productId: definition.productId,
          serialNumber: candidate.serialNumber || "unknown",
          path: candidate.path,
          simulated: false,
        },
      );
    }
  }

  async #attach(adapter) {
    this.#adapter = adapter;
    adapter.on("input", (event) => this.emit("input", event));
    adapter.on("error", (error) => {
      this.emit("deviceError", error);
      this.#detach().finally(() => this.#scheduleScan(600));
    });
    await adapter.start();
    this.#setStatus("connected", `${adapter.identity.model} is ready`, adapter.identity);
    this.emit("connected", adapter.identity);
  }

  async #detach() {
    const adapter = this.#adapter;
    if (!adapter) return;
    this.#adapter = null;
    await adapter.close().catch(() => undefined);
    this.emit("disconnected", adapter.identity);
  }

  #setStatus(state, message, device = null) {
    this.status = { state, message, device, mode: this.#mode };
    this.emit("status", structuredClone(this.status));
  }

  #scheduleScan(delay = 250) {
    clearTimeout(this.#rescanTimer);
    this.#rescanTimer = setTimeout(() => this.scan().catch(() => undefined), delay);
    this.#rescanTimer.unref?.();
  }

  #startUdevMonitor() {
    try {
      const monitor = spawn(
        "udevadm",
        ["monitor", "--udev", "--subsystem-match=hidraw", "--property"],
        { stdio: ["ignore", "pipe", "ignore"] },
      );
      this.#udevMonitor = monitor;
      monitor.stdout.setEncoding("utf8");
      monitor.stdout.on("data", () => this.#scheduleScan());
      monitor.once("error", () => {
        this.#udevMonitor = null;
      });
      monitor.once("exit", () => {
        this.#udevMonitor = null;
      });
      monitor.unref();
    } catch {
      // The 60-second reconciliation scan remains as the fallback.
    }
  }
}
