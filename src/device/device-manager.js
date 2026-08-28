import { spawn } from "node:child_process";
import EventEmitter from "node:events";
import { SUPPORTED_DEVICES } from "../constants.js";
import { deviceEventMonitorSpec, platformLabel } from "../platform.js";
import { errorMessage } from "../util.js";
import { HidM18Adapter } from "./hid-adapter.js";
import { MockM18Adapter } from "./mock-adapter.js";

function definitionFor(info) {
  return SUPPORTED_DEVICES.find(
    (device) => device.vendorId === info.vendorId && device.productId === info.productId,
  );
}

export function isControlInterface(info, platform = process.platform) {
  if (info.usagePage != null && info.usage != null) {
    return info.usagePage === 0xffa0 && info.usage === 0x01;
  }
  if (info.interface === 0) return true;
  if (platform === "win32") return /[&#]mi_00(?:[&#]|$)/i.test(info.path || "");
  return info.interface == null;
}

function permissionFailure(error) {
  return /permission|access denied|cannot open device|eacces/i.test(errorMessage(error));
}

export class DeviceManager extends EventEmitter {
  #mode;
  #adapter = null;
  #scanPromise = null;
  #deviceMonitor = null;
  #rescanTimer = null;
  #reconcileTimer = null;
  #stopped = false;

  constructor({
    mode = process.env.VSD_M18_MODE || "auto",
    platform = process.platform,
    spawnImplementation = spawn,
  } = {}) {
    super();
    if (!new Set(["auto", "real", "mock"]).has(mode)) {
      throw new TypeError("VSD_M18_MODE must be auto, real, or mock");
    }
    this.#mode = mode;
    this.platform = platform;
    this.spawnImplementation = spawnImplementation;
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
    this.#startDeviceMonitor();
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
    this.#deviceMonitor?.kill();
    this.#deviceMonitor = null;
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

    const candidate = devices.find(
      (info) => definitionFor(info) && isControlInterface(info, this.platform),
    );
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
          ? this.#accessFailureMessage()
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

  #accessFailureMessage() {
    if (this.platform === "linux") {
      return "M18 found, but Linux has not granted hidraw access. Run the included Linux installer, then reconnect the dock.";
    }
    if (this.platform === "win32") {
      return "M18 found, but Windows could not open its vendor HID interface. Close other dock software, then reconnect the M18.";
    }
    return `M18 found, but ${platformLabel(this.platform)} could not open its vendor HID interface.`;
  }

  #startDeviceMonitor() {
    const spec = deviceEventMonitorSpec({ platform: this.platform });
    if (!spec) return;
    try {
      const monitor = this.spawnImplementation(spec.executable, spec.args, {
        env: spec.env,
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      });
      this.#deviceMonitor = monitor;
      monitor.stdout?.setEncoding("utf8");
      monitor.stdout?.on("data", () => this.#scheduleScan());
      monitor.once("error", () => {
        this.#deviceMonitor = null;
      });
      monitor.once("exit", () => {
        this.#deviceMonitor = null;
      });
      monitor.unref();
    } catch {
      // The 60-second reconciliation scan remains as the fallback.
    }
  }
}
