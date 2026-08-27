import EventEmitter from "node:events";
import { AssetStore } from "./asset-store.js";
import { ActionRunner } from "./action-runner.js";
import { cloneProfile, createBlankProfile, validateConfig } from "./config-schema.js";
import { ConfigStore, RevisionConflictError } from "./config-store.js";
import { LCD_KEY_COUNT } from "./constants.js";
import { DeviceManager } from "./device/device-manager.js";
import { renderKeyJpeg } from "./device/protocol.js";
import { errorMessage, jsonClone, jsonFingerprint } from "./util.js";

function domainError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function preconditionFailure(message) {
  return domainError(409, message);
}

function hardwareStateFingerprint(config, profile) {
  return jsonFingerprint({
    profile,
    brightness: config.device.brightness,
    ledColor: config.device.ledColor,
  });
}

export class Controller extends EventEmitter {
  #operationQueue = Promise.resolve();
  #appliedSnapshot = null;

  constructor({
    configStore = new ConfigStore(),
    assetStore = new AssetStore(),
    deviceManager = new DeviceManager(),
    actionRunner = new ActionRunner(),
  } = {}) {
    super();
    this.configStore = configStore;
    this.assetStore = assetStore;
    this.deviceManager = deviceManager;
    this.actionRunner = actionRunner;
    this.lastEvent = null;
    this.operation = null;
  }

  async initialize() {
    await this.configStore.initialize();
    await this.assetStore.initialize();
    this.deviceManager.on("status", () => this.#emitState());
    this.deviceManager.on("input", (event) => this.#handleInput(event));
    this.deviceManager.on("connected", () => {
      this.#appliedSnapshot = null;
      if (this.configStore.get().device.autoApply) {
        this.applyActiveProfile().catch((error) => this.#reportError(error));
      }
      this.#emitState();
    });
    this.deviceManager.on("disconnected", () => {
      this.#appliedSnapshot = null;
      this.#emitState();
    });
    this.deviceManager.on("deviceError", (error) => this.#reportError(error));
    await this.deviceManager.start();
    this.#emitState();
    return this.getState();
  }

  getState() {
    const config = this.configStore.get();
    const activeProfile = config.profiles.find((profile) => profile.id === config.activeProfileId);
    const appliedState = this.#appliedSnapshot
      ? {
        profileId: this.#appliedSnapshot.profile.id,
        revision: this.#appliedSnapshot.revision,
        appliedAt: this.#appliedSnapshot.appliedAt,
        inSync: Boolean(
          activeProfile &&
          hardwareStateFingerprint(config, activeProfile) ===
            hardwareStateFingerprint(
              {
                device: {
                  brightness: this.#appliedSnapshot.brightness,
                  ledColor: this.#appliedSnapshot.ledColor,
                },
              },
              this.#appliedSnapshot.profile,
            )
        ),
      }
      : null;
    return {
      config,
      device: jsonClone(this.deviceManager.status),
      appliedState,
      recoveryNotice: this.configStore.recoveryNotice,
      lastEvent: this.lastEvent ? jsonClone(this.lastEvent) : null,
      operation: this.operation ? jsonClone(this.operation) : null,
    };
  }

  async replaceConfig(config, expectedRevision) {
    const saved = await this.configStore.replace(validateConfig(config), expectedRevision);
    this.#emitState();
    return saved;
  }

  async createProfile({ name, duplicateFrom = null, expectedRevision }) {
    let created;
    const config = await this.configStore.update((draft) => {
      const source = duplicateFrom
        ? draft.profiles.find((profile) => profile.id === duplicateFrom)
        : null;
      if (duplicateFrom && !source) throw domainError(404, "Profile to duplicate was not found");
      created = source ? cloneProfile(source, name || `${source.name} Copy`) : createBlankProfile(name || "New Profile");
      draft.profiles.push(created);
      draft.activeProfileId = created.id;
    }, expectedRevision);
    this.#emitState();
    return { profile: created, config };
  }

  async deleteProfile({ profileId, expectedRevision }) {
    const config = await this.configStore.update((draft) => {
      if (draft.profiles.length === 1) throw domainError(409, "The last profile cannot be deleted");
      const index = draft.profiles.findIndex((profile) => profile.id === profileId);
      if (index === -1) throw domainError(404, "Profile was not found");
      draft.profiles.splice(index, 1);
      if (draft.activeProfileId === profileId) draft.activeProfileId = draft.profiles[0].id;
      for (const profile of draft.profiles) {
        for (const key of profile.keys) {
          if (key.action.type === "profile" && key.action.profileId === profileId) {
            key.action = { type: "none" };
          }
        }
      }
    }, expectedRevision);
    this.#emitState();
    return config;
  }

  async setActiveProfile({ profileId, apply = false, expectedRevision }) {
    const config = await this.configStore.update((draft) => {
      if (!draft.profiles.some((profile) => profile.id === profileId)) {
        throw domainError(404, "Profile was not found");
      }
      draft.activeProfileId = profileId;
    }, expectedRevision);
    this.#emitState();
    const application = { requested: Boolean(apply), applied: false };
    if (apply) {
      try {
        application.result = await this.applyActiveProfile({
          expectedProfileId: profileId,
          expectedRevision: config.revision,
        });
        application.applied = true;
      } catch (error) {
        application.error = errorMessage(error);
      }
    }
    return { config, application };
  }

  async setBrightness({ value, expectedRevision }) {
    const current = this.configStore.get();
    if (expectedRevision !== current.revision) {
      throw new RevisionConflictError(expectedRevision, current.revision);
    }
    const candidate = validateConfig({
      ...current,
      device: { ...current.device, brightness: value },
    });
    const config = candidate.device.brightness === current.device.brightness
      ? current
      : await this.configStore.update((draft) => {
        draft.device.brightness = candidate.device.brightness;
      }, expectedRevision);
    this.#emitState();
    await this.deviceManager.adapter?.setBrightness(config.device.brightness);
    if (this.#appliedSnapshot && this.deviceManager.adapter) {
      this.#appliedSnapshot.brightness = config.device.brightness;
    }
    this.#emitState();
    return config;
  }

  async setLedColor({ color, expectedRevision }) {
    const current = this.configStore.get();
    if (expectedRevision !== current.revision) {
      throw new RevisionConflictError(expectedRevision, current.revision);
    }
    const candidate = validateConfig({
      ...current,
      device: { ...current.device, ledColor: color },
    });
    const config = candidate.device.ledColor === current.device.ledColor
      ? current
      : await this.configStore.update((draft) => {
        draft.device.ledColor = candidate.device.ledColor;
      }, expectedRevision);
    this.#emitState();
    await this.deviceManager.adapter?.setLedColor(config.device.ledColor);
    if (this.#appliedSnapshot && this.deviceManager.adapter) {
      this.#appliedSnapshot.ledColor = config.device.ledColor;
    }
    this.#emitState();
    return config;
  }

  applyActiveProfile({ expectedProfileId = null, expectedRevision = null } = {}) {
    return this.#enqueueOperation(async () => {
      const adapter = this.deviceManager.adapter;
      if (!adapter) throw domainError(409, "No M18 is connected");
      const config = this.configStore.get();
      if (expectedRevision !== null && expectedRevision !== config.revision) {
        throw new RevisionConflictError(expectedRevision, config.revision);
      }
      if (expectedProfileId !== null && expectedProfileId !== config.activeProfileId) {
        throw preconditionFailure(
          `Active profile changed: expected ${expectedProfileId}, current profile is ${config.activeProfileId}`,
        );
      }
      const profile = config.profiles.find((entry) => entry.id === config.activeProfileId);
      if (!profile) throw new Error("The active profile is missing");

      this.#appliedSnapshot = null;
      this.operation = { type: "apply", state: "working", progress: 0, total: LCD_KEY_COUNT };
      this.#emitState();
      try {
        const images = await Promise.all(
          profile.keys.slice(0, LCD_KEY_COUNT).map(async (key) => ({
            key: key.index,
            jpeg: await renderKeyJpeg(key, this.assetStore),
          })),
        );
        await adapter.applyProfile({
          images,
          brightness: config.device.brightness,
          ledColor: config.device.ledColor,
          onProgress: (progress, total) => {
            this.operation = {
              type: "apply",
              state: "working",
              progress,
              total,
            };
            this.#emitState();
          },
        });
        const appliedAt = new Date().toISOString();
        this.#appliedSnapshot = {
          revision: config.revision,
          profile: jsonClone(profile),
          brightness: config.device.brightness,
          ledColor: config.device.ledColor,
          appliedAt,
        };
        this.operation = {
          type: "apply",
          state: "complete",
          progress: images.length,
          total: images.length,
          completedAt: appliedAt,
        };
        this.#emitState();
        return { applied: true, profileId: profile.id, keys: images.length };
      } catch (error) {
        this.operation = { type: "apply", state: "error", message: errorMessage(error) };
        this.#emitState();
        throw error;
      }
    });
  }

  async triggerButton({
    key,
    confirm = false,
    source = "api",
    expectedProfileId = null,
    expectedRevision = null,
    expectedAction = null,
  }) {
    const config = this.configStore.get();
    if (source === "hardware" && this.operation?.state === "working") {
      throw domainError(409, "The M18 layout is still being applied; the button press was ignored");
    }
    if (source === "hardware" && !this.#appliedSnapshot) {
      throw domainError(409, "Apply a profile before physical M18 buttons can run actions");
    }
    const profile = source === "hardware"
      ? this.#appliedSnapshot.profile
      : config.profiles.find((entry) => entry.id === config.activeProfileId);
    const button = profile?.keys[key - 1];
    if (!button) throw new RangeError("M18 key index must be between 1 and 18");
    const action = button.action;
    if (source !== "hardware") {
      if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
        throw new TypeError("An expected configuration revision is required before triggering a button");
      }
      if (expectedRevision !== config.revision) {
        throw new RevisionConflictError(expectedRevision, config.revision);
      }
      if (!expectedProfileId || expectedProfileId !== profile.id) {
        throw preconditionFailure(
          `Active profile changed: expected ${expectedProfileId || "none"}, current profile is ${profile.id}`,
        );
      }
      if (expectedAction === null || jsonFingerprint(expectedAction) !== jsonFingerprint(action)) {
        throw preconditionFailure(`Key ${key} action changed after it was inspected; execution was stopped`);
      }
    }
    if (new Set(["command", "url"]).has(action.type) && source !== "hardware" && !confirm) {
      throw domainError(
        428,
        "This button launches an external action; call again with confirm=true after user approval",
      );
    }
    let result;
    if (action.type === "profile") {
      const current = this.configStore.get();
      const switched = await this.setActiveProfile({
        profileId: action.profileId,
        apply: Boolean(this.deviceManager.adapter),
        expectedRevision: current.revision,
      });
      result = {
        executed: true,
        type: "profile",
        profileId: action.profileId,
        application: switched.application,
      };
    } else {
      result = await this.actionRunner.run(action);
    }
    this.lastEvent = {
      type: "trigger",
      key,
      label: button.label,
      action: action.type,
      source,
      result,
      at: new Date().toISOString(),
    };
    this.#emitState();
    return this.lastEvent;
  }

  simulatePress({ key, confirm = false, expectedProfileId, expectedRevision, expectedAction }) {
    try {
      this.deviceManager.simulatePress(key, {
        confirm,
        expectedProfileId,
        expectedRevision,
        expectedAction,
      });
    } catch (error) {
      throw domainError(409, errorMessage(error));
    }
  }

  async stop() {
    await this.deviceManager.stop();
  }

  #enqueueOperation(operation) {
    const next = this.#operationQueue.then(operation, operation);
    this.#operationQueue = next.catch(() => undefined);
    return next;
  }

  #handleInput(event) {
    const {
      confirm = false,
      expectedProfileId = null,
      expectedRevision = null,
      expectedAction = null,
      simulated = false,
      ...inputEvent
    } = event;
    this.lastEvent = { type: "input", ...inputEvent, simulated, at: new Date().toISOString() };
    this.#emitState();
    if (event.pressed) {
      this.triggerButton({
        key: event.key,
        confirm: simulated ? confirm : true,
        source: simulated ? "simulator" : "hardware",
        expectedProfileId,
        expectedRevision,
        expectedAction,
      }).catch((error) => this.#reportError(error));
    }
  }

  #reportError(error) {
    this.lastEvent = { type: "error", message: errorMessage(error), at: new Date().toISOString() };
    this.#emitState();
  }

  #emitState() {
    if (!this.configStore) return;
    try {
      this.emit("state", this.getState());
    } catch {
      // Initialization can emit a device status before the config is available.
    }
  }
}
