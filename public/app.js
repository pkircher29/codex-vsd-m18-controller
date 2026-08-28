"use strict";

const byId = (id) => document.getElementById(id);
const clone = (value) => structuredClone(value);
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const INSTANCE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ACTION_LABELS = Object.freeze({
  none: "No action",
  command: "Run command",
  url: "Open URL",
  profile: "Switch profile",
});

function consumeInstanceToken() {
  const url = new URL(window.location.href);
  const supplied = url.searchParams.get("instance");
  let token = INSTANCE_TOKEN_PATTERN.test(supplied || "") ? supplied : null;
  try {
    if (token) sessionStorage.setItem("m18-instance-token", token);
    else token = sessionStorage.getItem("m18-instance-token");
  } catch {
    // The URL token still works when session storage is unavailable.
  }
  if (url.searchParams.has("instance")) {
    url.searchParams.delete("instance");
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }
  return INSTANCE_TOKEN_PATTERN.test(token || "") ? token : null;
}

const instanceToken = consumeInstanceToken();

const elements = {
  workspace: byId("main-workspace"),
  workspaceGrid: byId("workspaceGrid"),
  loadingPanel: byId("loadingPanel"),
  errorPanel: byId("errorPanel"),
  errorMessage: byId("errorMessage"),
  retryButton: byId("retryButton"),
  liveLink: byId("liveLink"),
  liveLinkText: byId("liveLinkText"),
  revisionLabel: byId("revisionLabel"),
  deviceStatusCell: byId("deviceStatusCell"),
  deviceStatusValue: byId("deviceStatusValue"),
  deviceStatusDetail: byId("deviceStatusDetail"),
  permissionStatusCell: byId("permissionStatusCell"),
  permissionStatusLabel: byId("permissionStatusLabel"),
  permissionStatusValue: byId("permissionStatusValue"),
  permissionStatusDetail: byId("permissionStatusDetail"),
  modeStatusCell: byId("modeStatusCell"),
  modeStatusValue: byId("modeStatusValue"),
  modeStatusDetail: byId("modeStatusDetail"),
  recoveryNotice: byId("recoveryNotice"),
  recoveryNoticeText: byId("recoveryNoticeText"),
  dismissRecovery: byId("dismissRecovery"),
  profileCount: byId("profileCount"),
  profileList: byId("profileList"),
  newProfileButton: byId("newProfileButton"),
  duplicateProfileButton: byId("duplicateProfileButton"),
  deleteProfileButton: byId("deleteProfileButton"),
  activeProfileName: byId("activeProfileName"),
  draftFlag: byId("draftFlag"),
  aiLayoutButton: byId("aiLayoutButton"),
  saveButton: byId("saveButton"),
  applyButton: byId("applyButton"),
  operationStrip: byId("operationStrip"),
  operationText: byId("operationText"),
  operationProgress: byId("operationProgress"),
  lcdGrid: byId("lcdGrid"),
  hardwareGrid: byId("hardwareGrid"),
  testSelection: byId("testSelection"),
  simulateButton: byId("simulateButton"),
  triggerButton: byId("triggerButton"),
  eventTime: byId("eventTime"),
  eventText: byId("eventText"),
  selectedKeyNumber: byId("selectedKeyNumber"),
  selectedKeyKind: byId("selectedKeyKind"),
  keyForm: byId("keyForm"),
  inspectorPreview: byId("inspectorPreview"),
  previewImage: byId("previewImage"),
  previewInitial: byId("previewInitial"),
  previewLabel: byId("previewLabel"),
  keyLabel: byId("keyLabel"),
  labelCount: byId("labelCount"),
  keyColor: byId("keyColor"),
  keyColorText: byId("keyColorText"),
  colorError: byId("colorError"),
  imageField: byId("imageField"),
  imageUpload: byId("imageUpload"),
  removeImageButton: byId("removeImageButton"),
  imageHint: byId("imageHint"),
  shortcutFile: byId("shortcutFile"),
  pasteCommandButton: byId("pasteCommandButton"),
  actionType: byId("actionType"),
  noneFields: byId("noneFields"),
  commandFields: byId("commandFields"),
  urlFields: byId("urlFields"),
  profileFields: byId("profileFields"),
  commandExecutable: byId("commandExecutable"),
  commandArgs: byId("commandArgs"),
  actionUrl: byId("actionUrl"),
  targetProfile: byId("targetProfile"),
  actionError: byId("actionError"),
  deviceControlsForm: byId("deviceControlsForm"),
  brightnessRange: byId("brightnessRange"),
  brightnessOutput: byId("brightnessOutput"),
  ledColor: byId("ledColor"),
  ledColorText: byId("ledColorText"),
  profileDialog: byId("profileDialog"),
  profileDialogForm: byId("profileDialogForm"),
  profileDialogTitle: byId("profileDialogTitle"),
  profileDialogDescription: byId("profileDialogDescription"),
  profileName: byId("profileName"),
  profileDialogError: byId("profileDialogError"),
  submitProfileDialog: byId("submitProfileDialog"),
  cancelProfileDialog: byId("cancelProfileDialog"),
  aiDialog: byId("aiDialog"),
  aiDialogForm: byId("aiDialogForm"),
  aiProvider: byId("aiProvider"),
  aiEndpointField: byId("aiEndpointField"),
  aiEndpoint: byId("aiEndpoint"),
  aiApiKeyField: byId("aiApiKeyField"),
  aiApiKey: byId("aiApiKey"),
  aiModel: byId("aiModel"),
  aiModelList: byId("aiModelList"),
  aiModelHint: byId("aiModelHint"),
  loadModelsButton: byId("loadModelsButton"),
  aiPrompt: byId("aiPrompt"),
  aiDialogError: byId("aiDialogError"),
  aiPreview: byId("aiPreview"),
  aiPreviewSummary: byId("aiPreviewSummary"),
  aiPreviewGrid: byId("aiPreviewGrid"),
  cancelAiDialog: byId("cancelAiDialog"),
  generateAiLayoutButton: byId("generateAiLayoutButton"),
  acceptAiLayoutButton: byId("acceptAiLayoutButton"),
  pasteDialog: byId("pasteDialog"),
  pasteDialogForm: byId("pasteDialogForm"),
  pasteDialogKey: byId("pasteDialogKey"),
  pastedCommand: byId("pastedCommand"),
  pasteDialogError: byId("pasteDialogError"),
  cancelPasteDialog: byId("cancelPasteDialog"),
  confirmDialog: byId("confirmDialog"),
  confirmDialogIndex: byId("confirmDialogIndex"),
  confirmDialogKicker: byId("confirmDialogKicker"),
  confirmDialogTitle: byId("confirmDialogTitle"),
  confirmDialogMessage: byId("confirmDialogMessage"),
  confirmDialogButton: byId("confirmDialogButton"),
  toastRegion: byId("toastRegion"),
  keyContextMenu: byId("keyContextMenu"),
  contextPasteCommand: byId("contextPasteCommand"),
  contextChooseShortcut: byId("contextChooseShortcut"),
  contextClearAction: byId("contextClearAction"),
};

const ui = {
  serverState: null,
  draftConfig: null,
  dirty: false,
  stale: false,
  selectedKey: 1,
  busyCount: 0,
  busyMessage: "",
  eventSource: null,
  liveState: "connecting",
  profileDialogMode: "create",
  dialogOpener: null,
  aiDialogOpener: null,
  pasteDialogOpener: null,
  aiProposal: null,
  aiBusy: false,
  pasteTargetKey: 1,
  contextKey: null,
  confirmResolver: null,
  confirmOpener: null,
  lastRenderedEventId: "",
  staleToastShown: false,
};

let mutationTail = Promise.resolve();

class ApiError extends Error {
  constructor(message, status, body = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

class UiValidationError extends Error {
  constructor(message, { profileId = null, key = null, field = null } = {}) {
    super(message);
    this.name = "UiValidationError";
    this.profileId = profileId;
    this.key = key;
    this.field = field;
  }
}

function isMutation(method) {
  return !new Set(["GET", "HEAD", "OPTIONS"]).has(method);
}

async function apiRequest(path, { method = "GET", json, body, headers = {} } = {}) {
  const requestHeaders = new Headers(headers);
  requestHeaders.set("Accept", "application/json");
  if (instanceToken) requestHeaders.set("X-VSD-Instance-Token", instanceToken);
  if (isMutation(method)) requestHeaders.set("X-VSD-Local-Client", "ui");
  if (json !== undefined) {
    requestHeaders.set("Content-Type", "application/json");
    body = JSON.stringify(json);
  }

  let response;
  try {
    response = await fetch(path, {
      method,
      headers: requestHeaders,
      body,
      credentials: "same-origin",
      cache: method === "GET" ? "no-store" : "default",
    });
  } catch (error) {
    throw new ApiError(
      error instanceof Error ? error.message : "The local controller is unreachable",
      0,
    );
  }

  const contentType = response.headers.get("content-type") || "";
  let payload = null;
  if (response.status !== 204) {
    try {
      payload = contentType.includes("application/json")
        ? await response.json()
        : await response.text();
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && typeof payload.error === "string"
        ? payload.error
        : typeof payload === "string" && payload
          ? payload
          : `Request failed with status ${response.status}`;
    throw new ApiError(message, response.status, payload);
  }

  return payload;
}

function stateFromResponse(payload) {
  if (payload?.state?.config) return payload.state;
  if (payload?.config && payload?.device) return payload;
  return null;
}

function activeProfile() {
  if (!ui.draftConfig) return null;
  return (
    ui.draftConfig.profiles.find((profile) => profile.id === ui.draftConfig.activeProfileId) ||
    ui.draftConfig.profiles[0] ||
    null
  );
}

function selectedKeyConfig() {
  return activeProfile()?.keys[ui.selectedKey - 1] || null;
}

function executionSnapshot(state, keyIndex) {
  const profile = state?.config?.profiles.find(
    (entry) => entry.id === state.config.activeProfileId,
  );
  const key = profile?.keys[keyIndex - 1];
  if (!profile || !key) throw new Error("The selected key is missing from the saved profile");
  return {
    profileId: profile.id,
    expectedRevision: state.config.revision,
    expectedAction: clone(key.action),
  };
}

function padKey(index) {
  return String(index).padStart(2, "0");
}

function normalizeColor(color, fallback = "#C47A32") {
  return HEX_COLOR.test(String(color || "")) ? String(color).toUpperCase() : fallback;
}

function keyTextColor(color) {
  const clean = normalizeColor(color).slice(1);
  const channels = [0, 2, 4].map((offset) => Number.parseInt(clean.slice(offset, offset + 2), 16) / 255);
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue > 0.179 ? "#000000" : "#FFFFFF";
}

function keyTextShadow(color) {
  return keyTextColor(color) === "#FFFFFF" ? "0 1px 2px rgb(0 0 0 / 82%)" : "none";
}

function assetUrl(assetId) {
  const suffix = instanceToken ? `?instance=${encodeURIComponent(instanceToken)}` : "";
  return `/api/assets/${encodeURIComponent(assetId)}${suffix}`;
}

function actionLabel(action) {
  return ACTION_LABELS[action?.type] || "Unknown action";
}

function actionSummary(action) {
  if (!action || action.type === "none") return "No action";
  if (action.type === "command") {
    if (!action.executable) return "Incomplete command";
    return [action.executable, ...(action.args || [])]
      .map((token) => JSON.stringify(token))
      .join(" ");
  }
  if (action.type === "url") return action.url || "Incomplete URL";
  if (action.type === "profile") {
    const profile = ui.draftConfig?.profiles.find((entry) => entry.id === action.profileId);
    return `Switch to ${profile?.name || "missing profile"}`;
  }
  return "Unknown action";
}

function setLiveState(state, text) {
  ui.liveState = state;
  elements.liveLink.dataset.state = state;
  elements.liveLinkText.textContent = text;
}

function showInitialError(error) {
  elements.loadingPanel.hidden = true;
  elements.workspaceGrid.hidden = true;
  elements.errorMessage.textContent = error.message || "The local controller did not respond.";
  elements.errorPanel.hidden = false;
  elements.workspace.setAttribute("aria-busy", "false");
  setLiveState("offline", "Offline");
}

function adoptServerState(nextState, { replaceDraft = false, source = "response" } = {}) {
  if (!nextState?.config) return;
  const previousEvent = ui.serverState?.lastEvent;
  const previousRevision = ui.serverState?.config?.revision;
  ui.serverState = nextState;

  if (!ui.draftConfig || replaceDraft || !ui.dirty) {
    ui.draftConfig = clone(nextState.config);
    ui.dirty = false;
    ui.stale = false;
    ui.staleToastShown = false;
    ensureSelectionExists();
    renderAll();
  } else if (source === "sse" && ui.dirty && nextState.config.revision !== previousRevision) {
    ui.stale = true;
    if (!ui.staleToastShown && ui.busyCount === 0) {
      ui.staleToastShown = true;
      showToast({
        tone: "error",
        title: "Newer configuration detected",
        message: "Your draft is preserved. Reload the current revision before saving.",
        duration: 10000,
      });
    }
    renderTransient();
  } else {
    renderTransient();
  }

  const currentEvent = nextState.lastEvent;
  if (currentEvent && eventIdentity(currentEvent) !== eventIdentity(previousEvent)) {
    flashKey(currentEvent.key);
  }
}

function eventIdentity(event) {
  return event ? `${event.at || ""}:${event.type || ""}:${event.key || ""}:${event.pressed ?? ""}` : "";
}

function ensureSelectionExists() {
  const profiles = ui.draftConfig?.profiles || [];
  if (!profiles.some((profile) => profile.id === ui.draftConfig.activeProfileId) && profiles[0]) {
    ui.draftConfig.activeProfileId = profiles[0].id;
  }
  const keys = activeProfile()?.keys || [];
  if (!keys.some((key) => key.index === ui.selectedKey)) ui.selectedKey = 1;
}

async function loadState({ preserveDraft = false } = {}) {
  if (!ui.serverState) {
    elements.loadingPanel.hidden = false;
    elements.errorPanel.hidden = true;
    elements.workspaceGrid.hidden = true;
    elements.workspace.setAttribute("aria-busy", "true");
  }
  const nextState = await apiRequest("/api/state");
  if (preserveDraft && ui.dirty) {
    const priorDraft = ui.draftConfig;
    ui.serverState = nextState;
    ui.draftConfig = priorDraft;
    ui.stale = true;
    renderAll();
  } else {
    adoptServerState(nextState, { replaceDraft: true, source: "load" });
  }
  elements.loadingPanel.hidden = true;
  elements.errorPanel.hidden = true;
  elements.workspaceGrid.hidden = false;
  elements.workspace.setAttribute("aria-busy", "false");
}

function connectEventStream() {
  ui.eventSource?.close();
  setLiveState("connecting", "Connecting");
  const streamUrl = instanceToken
    ? `/api/events?instance=${encodeURIComponent(instanceToken)}`
    : "/api/events";
  const stream = new EventSource(streamUrl);
  ui.eventSource = stream;
  stream.addEventListener("open", () => setLiveState("live", "Live link"));
  stream.addEventListener("state", (event) => {
    try {
      const nextState = JSON.parse(event.data);
      adoptServerState(nextState, { source: "sse" });
      setLiveState("live", "Live link");
    } catch {
      setLiveState("offline", "Bad event");
    }
  });
  stream.addEventListener("error", () => {
    setLiveState("connecting", "Reconnecting");
  });
}

function renderAll() {
  if (!ui.draftConfig || !ui.serverState) return;
  elements.loadingPanel.hidden = true;
  elements.errorPanel.hidden = true;
  elements.workspaceGrid.hidden = false;
  renderStatus();
  renderProfiles();
  renderDeck();
  renderInspector();
  renderDeviceControls();
  renderOperation();
  renderEvent();
  renderRevision();
  renderControlAvailability();
  renderRecoveryNotice();
}

function renderTransient() {
  if (!ui.serverState || !ui.draftConfig) return;
  renderStatus();
  renderOperation();
  renderEvent();
  renderRevision();
  renderControlAvailability();
  renderRecoveryNotice();
}

function setStatusCell(cell, valueElement, detailElement, { tone, value, detail }) {
  cell.dataset.tone = tone;
  valueElement.textContent = value;
  detailElement.textContent = detail;
  detailElement.title = detail;
}

function runtimePlatform() {
  const runtime = ui.serverState?.runtime || {};
  const rawPlatform = String(runtime.platform || "").trim().toLowerCase();
  const knownPlatforms = {
    win32: { key: "windows", label: "Windows" },
    windows: { key: "windows", label: "Windows" },
    linux: { key: "linux", label: "Linux" },
    darwin: { key: "macos", label: "macOS" },
    macos: { key: "macos", label: "macOS" },
  };
  const known = knownPlatforms[rawPlatform];
  const serverLabel =
    typeof runtime.platformLabel === "string" ? runtime.platformLabel.trim() : "";
  return {
    key: known?.key || "unknown",
    label: serverLabel || known?.label || "Local",
    identified: Boolean(serverLabel || known),
  };
}

function renderStatus() {
  const status = ui.serverState.device || {};
  const identity = status.device;
  const state = status.state || "starting";
  const platform = runtimePlatform();
  const devicePresentation = {
    connected: {
      tone: "good",
      value: identity?.model || "M18 ready",
      detail: identity?.simulated
        ? "Virtual transport online"
        : `${formatUsbId(identity)} · ${identity?.serialNumber || "serial unknown"}`,
    },
    permission: {
      tone: "danger",
      value: "Access blocked",
      detail: identity ? `${formatUsbId(identity)} detected` : "M18 detected",
    },
    disconnected: {
      tone: "warning",
      value: "Not connected",
      detail: status.message || "Connect a supported M18 by USB",
    },
    error: {
      tone: "danger",
      value: "Driver error",
      detail: status.message || "Inspect the service log",
    },
    starting: {
      tone: "neutral",
      value: "Inspecting USB",
      detail: status.message || "Hardware discovery in progress",
    },
  }[state] || {
    tone: "neutral",
    value: state,
    detail: status.message || "Status unavailable",
  };
  setStatusCell(
    elements.deviceStatusCell,
    elements.deviceStatusValue,
    elements.deviceStatusDetail,
    devicePresentation,
  );

  elements.permissionStatusLabel.textContent = platform.identified
    ? `${platform.label} access`
    : "Device access";

  let permissionPresentation;
  if (identity?.simulated) {
    permissionPresentation = {
      tone: "neutral",
      value: "Bypassed",
      detail:
        platform.key === "linux"
          ? "Simulator uses no hidraw node"
          : platform.key === "windows"
            ? "Simulator needs no Windows device access"
            : "Simulator needs no hardware access",
    };
  } else if (state === "connected") {
    permissionPresentation = {
      tone: "good",
      value: platform.key === "windows" ? "Ready" : "Granted",
      detail:
        platform.key === "linux"
          ? "hidraw opened without root"
          : platform.key === "windows"
            ? "Windows HID interface opened"
            : "HID interface opened by the local service",
    };
  } else if (state === "permission") {
    const fallbackGuidance =
      platform.key === "linux"
        ? "Install the udev rule, then reconnect the dock"
        : platform.key === "windows"
          ? "Close other dock software, then reconnect the M18"
          : "Allow device access, then reconnect the M18";
    permissionPresentation = {
      tone: "danger",
      value: "Action required",
      detail: status.message || fallbackGuidance,
    };
  } else if (state === "error") {
    permissionPresentation = {
      tone: "warning",
      value: "Unknown",
      detail: "The device driver failed before the access check",
    };
  } else {
    permissionPresentation = {
      tone: "neutral",
      value: "Not checked",
      detail: "Waiting for an M18 device",
    };
  }
  setStatusCell(
    elements.permissionStatusCell,
    elements.permissionStatusValue,
    elements.permissionStatusDetail,
    permissionPresentation,
  );

  const mode = status.mode || "auto";
  const simulated = Boolean(identity?.simulated) || mode === "mock";
  setStatusCell(elements.modeStatusCell, elements.modeStatusValue, elements.modeStatusDetail, {
    tone: simulated ? "warning" : state === "connected" ? "good" : "neutral",
    value: simulated ? "Simulator" : mode === "real" ? "Hardware only" : "Auto discover",
    detail: simulated
      ? "Press testing is available"
      : platform.identified
        ? `${platform.label} HID transport`
        : "Local HID transport",
  });
}

function formatUsbId(identity) {
  if (!identity || !Number.isFinite(identity.vendorId) || !Number.isFinite(identity.productId)) {
    return "USB ID unknown";
  }
  return `${identity.vendorId.toString(16).padStart(4, "0")}:${identity.productId
    .toString(16)
    .padStart(4, "0")}`;
}

function renderProfiles() {
  const profiles = ui.draftConfig.profiles;
  const activeId = ui.draftConfig.activeProfileId;
  const fragment = document.createDocumentFragment();

  profiles.forEach((profile, index) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    const copy = document.createElement("span");
    const name = document.createElement("span");
    const meta = document.createElement("span");
    const arrow = document.createElement("span");
    const assigned = profile.keys.filter((key) => key.action.type !== "none").length;

    button.type = "button";
    button.className = "profile-button";
    button.dataset.profileId = profile.id;
    button.setAttribute("aria-pressed", String(profile.id === activeId));
    button.setAttribute(
      "aria-label",
      `${profile.name}, profile ${index + 1} of ${profiles.length}, ${assigned} assigned actions`,
    );
    name.className = "profile-button-name";
    name.textContent = profile.name;
    meta.className = "profile-button-meta";
    meta.textContent = `${assigned.toString().padStart(2, "0")} actions · 18 keys`;
    copy.append(name, meta);
    arrow.className = "profile-arrow";
    arrow.textContent = profile.id === activeId ? "◆" : "›";
    arrow.setAttribute("aria-hidden", "true");
    button.append(copy, arrow);
    button.addEventListener("click", () => selectProfile(profile.id));
    item.append(button);
    fragment.append(item);
  });

  elements.profileList.replaceChildren(fragment);
  elements.profileCount.textContent = String(profiles.length).padStart(2, "0");
  elements.profileCount.setAttribute("aria-label", `${profiles.length} profiles`);
  elements.activeProfileName.textContent = activeProfile()?.name || "No profile";
}

function renderDeck() {
  const profile = activeProfile();
  if (!profile) return;
  const lcdFragment = document.createDocumentFragment();
  const hardwareFragment = document.createDocumentFragment();

  profile.keys.forEach((key) => {
    const button = createDeckButton(key);
    if (key.index <= 15) lcdFragment.append(button);
    else hardwareFragment.append(button);
  });

  elements.lcdGrid.replaceChildren(lcdFragment);
  elements.hardwareGrid.replaceChildren(hardwareFragment);
  const selected = selectedKeyConfig();
  elements.testSelection.textContent = selected
    ? `Key ${padKey(selected.index)} · ${selected.label || "Unlabeled"}`
    : "Key —";
}

function createDeckButton(key) {
  const button = document.createElement("button");
  const number = document.createElement("span");
  const label = document.createElement("span");
  const action = document.createElement("span");
  const actionText = actionSummary(key.action);

  button.type = "button";
  button.className = `deck-key ${key.index <= 15 ? "lcd-key" : "hardware-key"}`;
  button.dataset.key = String(key.index);
  const keyColor = normalizeColor(key.color);
  button.style.setProperty("--key-color", keyColor);
  button.style.setProperty("--key-text", keyTextColor(keyColor));
  button.style.setProperty("--key-shadow", keyTextShadow(keyColor));
  if (key.index <= 15) button.style.backgroundColor = keyColor;
  button.setAttribute("aria-pressed", String(key.index === ui.selectedKey));
  button.setAttribute("aria-describedby", "dropGuidance");
  button.setAttribute(
    "aria-label",
    `Key ${key.index}, ${key.label || "unlabeled"}. ${actionText}. Select for editing.`,
  );
  button.title = `Key ${key.index} · ${actionText}`;
  if (key.assetId && key.index <= 15) {
    button.classList.add("has-image");
    button.style.setProperty("--key-text", "#FFFFFF");
    button.style.setProperty("--key-shadow", "0 1px 2px rgb(0 0 0 / 82%)");
    button.style.backgroundImage = `url("${assetUrl(key.assetId)}")`;
  }

  number.className = "key-number";
  number.textContent = padKey(key.index);
  number.setAttribute("aria-hidden", "true");
  label.className = "key-label";
  label.textContent = key.label || "UNLABELED";
  label.setAttribute("aria-hidden", "true");
  action.className = "key-action-mark";
  action.dataset.action = key.action.type;
  action.setAttribute("aria-hidden", "true");
  button.append(number, label, action);
  button.addEventListener("click", () => selectKey(key.index));
  button.addEventListener("keydown", handleDeckNavigation);
  button.addEventListener("contextmenu", (event) => openKeyContextMenu(event, key.index));
  button.addEventListener("dragenter", handleKeyDragEnter);
  button.addEventListener("dragover", handleKeyDragOver);
  button.addEventListener("dragleave", handleKeyDragLeave);
  button.addEventListener("drop", (event) => handleKeyDrop(event, key.index));
  return button;
}

function handleDeckNavigation(event) {
  if ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu") {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    openKeyContextMenu(
      { preventDefault() {}, clientX: rect.left + Math.min(28, rect.width / 2), clientY: rect.top + Math.min(28, rect.height / 2) },
      Number(event.currentTarget.dataset.key),
    );
    return;
  }
  if (!new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]).has(event.key)) {
    return;
  }
  const current = Number(event.currentTarget.dataset.key);
  let target = current;
  if (event.key === "Home") target = 1;
  if (event.key === "End") target = 18;
  if (event.key === "ArrowLeft") {
    if (current <= 15 && (current - 1) % 5 !== 0) target = current - 1;
    if (current > 16) target = current - 1;
  }
  if (event.key === "ArrowRight") {
    if (current <= 15 && current % 5 !== 0) target = current + 1;
    if (current >= 16 && current < 18) target = current + 1;
  }
  if (event.key === "ArrowUp") {
    if (current > 5 && current <= 15) target = current - 5;
    if (current === 16) target = 11;
    if (current === 17) target = 13;
    if (current === 18) target = 15;
  }
  if (event.key === "ArrowDown") {
    if (current <= 10) target = current + 5;
    if (current >= 11 && current <= 15) target = current <= 12 ? 16 : current === 13 ? 17 : 18;
  }
  if (target !== current || event.key === "Home" || event.key === "End") {
    event.preventDefault();
    const next = document.querySelector(`.deck-key[data-key="${target}"]`);
    next?.focus();
  }
}

function openKeyContextMenu(event, keyIndex) {
  event.preventDefault();
  selectKey(keyIndex);
  ui.contextKey = keyIndex;
  const menu = elements.keyContextMenu;
  menu.hidden = false;
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  const left = Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  requestAnimationFrame(() => menu.querySelector("button")?.focus());
}

function closeKeyContextMenu({ restoreFocus = false } = {}) {
  if (elements.keyContextMenu.hidden) return;
  const key = ui.contextKey;
  elements.keyContextMenu.hidden = true;
  ui.contextKey = null;
  if (restoreFocus && key) {
    requestAnimationFrame(() => document.querySelector(`.deck-key[data-key="${key}"]`)?.focus());
  }
}

function isSupportedDrop(event) {
  const types = new Set(event.dataTransfer?.types || []);
  return types.has("Files") || types.has("text/plain") || types.has("text/uri-list");
}

function handleKeyDragEnter(event) {
  if (!isSupportedDrop(event)) return;
  event.preventDefault();
  event.currentTarget.classList.add("is-drop-target");
}

function handleKeyDragOver(event) {
  if (!isSupportedDrop(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  event.currentTarget.classList.add("is-drop-target");
}

function handleKeyDragLeave(event) {
  if (event.currentTarget.contains(event.relatedTarget)) return;
  event.currentTarget.classList.remove("is-drop-target");
}

async function stageImageFile(file, targetKey) {
  if (!IMAGE_TYPES.has(file.type)) {
    throw new UiValidationError("Choose a PNG, JPEG, WebP, or GIF file");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new UiValidationError("Choose an image no larger than 2 MB");
  }
  if (targetKey > 15) throw new UiValidationError("Only LCD keys 1 through 15 accept images");
  const response = await apiRequest("/api/assets", {
    method: "POST",
    body: file,
    headers: { "Content-Type": file.type },
  });
  const asset = response?.asset;
  const assetId = typeof asset === "string" ? asset : asset?.id;
  if (!assetId) throw new Error("The controller did not return an image identifier");
  const key = activeProfile()?.keys[targetKey - 1];
  if (!key) throw new Error("The target key is missing");
  key.assetId = assetId;
  markDirty();
  ui.selectedKey = targetKey;
  renderDeck();
  renderInspector();
  renderRevision();
  renderOperation();
  renderControlAvailability();
  showToast({
    tone: "success",
    title: "Image staged",
    message: `${asset?.width || "Image"}×${asset?.height || "?"} source assigned to key ${padKey(targetKey)}. Save or apply to keep it.`,
  });
}

function stageResolvedShortcut(shortcut, targetKey) {
  const key = activeProfile()?.keys[targetKey - 1];
  if (!key) throw new Error("The target key is missing");
  key.label = String(shortcut?.label || key.label || "Shortcut").slice(0, 32);
  key.action = clone(shortcut?.action || { type: "none" });
  markDirty();
  ui.selectedKey = targetKey;
  renderDeck();
  renderInspector();
  renderRevision();
  renderOperation();
  renderControlAvailability();
  showToast({
    tone: "success",
    title: "Shortcut staged",
    message: `${actionLabel(key.action)} assigned to key ${padKey(targetKey)}. Review it, then save or apply.`,
  });
}

async function resolveAndStageShortcut({ targetKey, name = "Shortcut", content = "", source = "" }) {
  const response = await apiRequest("/api/shortcuts/resolve", {
    method: "POST",
    json: { name, content, source },
  });
  if (!response?.shortcut) throw new Error("The controller could not read that shortcut");
  stageResolvedShortcut(response.shortcut, targetKey);
}

async function stageDroppedFile(file, targetKey, source = "") {
  if (IMAGE_TYPES.has(file.type)) return stageImageFile(file, targetKey);
  if (/\.(sh|command)$/i.test(file.name) && !source) {
    throw new UiValidationError("Drag the installed app shortcut or executable path, not a copied script file");
  }
  const content = file.size <= 256 * 1024 ? await file.text() : "";
  return resolveAndStageShortcut({ targetKey, name: file.name, content, source });
}

function handleKeyDrop(event, keyIndex) {
  event.preventDefault();
  event.currentTarget.classList.remove("is-drop-target");
  const transfer = event.dataTransfer;
  const file = transfer?.files?.[0] || null;
  const uri = transfer?.getData("text/uri-list")?.split(/\r?\n/).find((line) => line && !line.startsWith("#")) || "";
  const plain = transfer?.getData("text/plain") || "";
  runMutation("Reading dropped shortcut", async () => {
    if (file) return stageDroppedFile(file, keyIndex, uri.startsWith("file:") ? uri : "");
    const value = uri || plain;
    if (!value) throw new UiValidationError("Drop a shortcut, image, web address, or command onto the key");
    return resolveAndStageShortcut({ targetKey: keyIndex, name: "Dropped shortcut", content: value, source: value });
  });
}

function renderInspector() {
  const key = selectedKeyConfig();
  if (!key) return;
  const isLcd = key.index <= 15;
  const color = normalizeColor(key.color);

  elements.selectedKeyNumber.textContent = padKey(key.index);
  elements.selectedKeyKind.textContent = isLcd ? "LCD" : "CHASSIS";
  elements.inspectorPreview.style.setProperty("--key-color", color);
  elements.inspectorPreview.style.setProperty("--key-text", isLcd && key.assetId ? "#FFFFFF" : keyTextColor(color));
  elements.inspectorPreview.style.setProperty(
    "--key-shadow",
    isLcd && key.assetId ? "0 1px 2px rgb(0 0 0 / 82%)" : keyTextShadow(color),
  );
  elements.previewInitial.textContent = padKey(key.index);
  elements.previewLabel.textContent = key.label || "UNLABELED";
  elements.keyLabel.value = key.label || "";
  elements.labelCount.textContent = String((key.label || "").length);
  elements.keyColor.value = color;
  elements.keyColorText.value = color;
  clearFieldError(elements.keyColorText, elements.colorError);

  if (isLcd && key.assetId) {
    elements.previewImage.src = assetUrl(key.assetId);
    elements.previewImage.hidden = false;
  } else {
    elements.previewImage.hidden = true;
    elements.previewImage.removeAttribute("src");
  }
  elements.imageField.hidden = !isLcd;
  elements.removeImageButton.disabled = !key.assetId;
  elements.imageHint.textContent = key.assetId
    ? "Custom image assigned · PNG, JPEG, WebP, or GIF"
    : "PNG, JPEG, WebP, or GIF · 2 MB maximum";

  const action = key.action || { type: "none" };
  elements.actionType.value = action.type;
  elements.commandExecutable.value = action.type === "command" ? action.executable || "" : "";
  elements.commandArgs.value = action.type === "command" ? (action.args || []).join("\n") : "";
  elements.actionUrl.value = action.type === "url" ? action.url || "" : "";
  renderTargetProfiles(action.type === "profile" ? action.profileId : null);
  renderActionFields(action.type);
  clearActionErrors();
}

function renderTargetProfiles(selectedId) {
  const fragment = document.createDocumentFragment();
  for (const profile of ui.draftConfig.profiles) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.name;
    option.selected = profile.id === selectedId;
    fragment.append(option);
  }
  elements.targetProfile.replaceChildren(fragment);
  if (!elements.targetProfile.value && ui.draftConfig.profiles[0]) {
    elements.targetProfile.value = ui.draftConfig.profiles[0].id;
  }
}

function renderActionFields(type) {
  elements.noneFields.hidden = type !== "none";
  elements.commandFields.hidden = type !== "command";
  elements.urlFields.hidden = type !== "url";
  elements.profileFields.hidden = type !== "profile";
  elements.commandExecutable.required = type === "command";
  elements.actionUrl.required = type === "url";
  elements.targetProfile.required = type === "profile";
}

function renderDeviceControls() {
  const device = ui.draftConfig.device;
  const brightness = Number.isFinite(Number(device.brightness)) ? Number(device.brightness) : 72;
  const color = normalizeColor(device.ledColor, "#E59B3A");
  elements.brightnessRange.value = String(brightness);
  elements.brightnessOutput.value = `${brightness}%`;
  elements.brightnessOutput.textContent = `${brightness}%`;
  elements.ledColor.value = color;
  elements.ledColorText.value = color;
}

function renderOperation() {
  const operation = ui.serverState?.operation;
  let state = "idle";
  let text = "Ready to configure";
  let progress = null;

  if (operation?.state === "working") {
    state = "working";
    const done = Number(operation.progress) || 0;
    const total = Number(operation.total) || 15;
    text = operation.type === "apply" ? `Writing display ${done} of ${total}` : "Hardware operation in progress";
    progress = { done, total };
  } else if (operation?.state === "error") {
    state = "error";
    text = operation.message || "The last hardware operation failed";
  } else if (ui.busyCount > 0) {
    state = "working";
    text = ui.busyMessage || "Updating local configuration";
  } else if (ui.stale) {
    state = "error";
    text = "A newer server revision is available · reload before saving";
  } else if (ui.dirty) {
    state = "idle";
    text = "Draft changed · save or apply when ready";
  } else if (
    ui.serverState?.device?.state === "connected" &&
    (!ui.serverState.appliedState || !ui.serverState.appliedState.inSync)
  ) {
    state = "idle";
    text = ui.serverState.appliedState
      ? "Saved layout differs from the dock · apply when ready"
      : "Action state unverified · apply before physical use";
  } else if (operation?.state === "complete") {
    state = "complete";
    text = `Profile applied · ${formatRelativeTime(operation.completedAt)}`;
  }

  elements.operationStrip.dataset.state = state;
  elements.operationText.textContent = text;
  if (progress) {
    elements.operationProgress.hidden = false;
    elements.operationProgress.max = progress.total;
    elements.operationProgress.value = progress.done;
    elements.operationProgress.textContent = `${progress.done} of ${progress.total}`;
  } else {
    elements.operationProgress.hidden = true;
    elements.operationProgress.value = 0;
  }
}

function renderEvent() {
  const event = ui.serverState?.lastEvent;
  if (!event) {
    elements.eventTime.removeAttribute("datetime");
    elements.eventTime.textContent = "No input yet";
    elements.eventText.textContent = "Press a hardware key or use the simulator to inspect the signal path.";
    return;
  }

  if (event.at) {
    elements.eventTime.dateTime = event.at;
    elements.eventTime.textContent = formatRelativeTime(event.at);
  } else {
    elements.eventTime.removeAttribute("datetime");
    elements.eventTime.textContent = "Just now";
  }

  if (event.type === "error") {
    elements.eventText.textContent = `Error · ${event.message || "Unknown device error"}`;
  } else if (event.type === "input") {
    elements.eventText.textContent = `Key ${padKey(event.key)} · ${event.pressed ? "pressed" : "released"} · ${event.source || "device"}`;
  } else if (event.type === "trigger") {
    elements.eventText.textContent = `Key ${padKey(event.key)} · ${event.label || "Unlabeled"} · ${actionLabel({ type: event.action })}`;
  } else {
    elements.eventText.textContent = event.message || `Key ${event.key || "—"} signal received`;
  }
}

function renderRevision() {
  const revision = ui.serverState?.config?.revision;
  const suffix = ui.stale ? " · stale draft" : ui.dirty ? " · draft" : " · saved";
  elements.revisionLabel.textContent = `Revision ${revision ?? "—"}${suffix}`;
  elements.draftFlag.hidden = !ui.dirty;
  elements.draftFlag.textContent = ui.stale ? "Stale draft" : "Unsaved";
}

function renderControlAvailability() {
  const busy = ui.busyCount > 0;
  const deviceStatus = ui.serverState?.device;
  const connected = deviceStatus?.state === "connected";
  const simulated = Boolean(deviceStatus?.device?.simulated) || deviceStatus?.mode === "mock";
  const profiles = ui.draftConfig?.profiles || [];
  const hasProfile = Boolean(activeProfile());

  for (const control of document.querySelectorAll("[data-mutation]")) {
    control.disabled = busy;
    control.setAttribute("aria-busy", String(busy));
  }
  // Keep Save available for a stale draft: persistDraft() uses this entry point
  // to offer the explicit reload-and-discard recovery dialog.
  elements.saveButton.disabled = busy || !ui.dirty;
  elements.saveButton.title = ui.stale
    ? "Resolve the revision conflict"
    : "Save this configuration without writing the device";
  elements.applyButton.disabled = busy || !connected || !hasProfile || ui.stale;
  elements.applyButton.title = connected ? "Save the draft and write all 15 LCD keys" : "Connect an M18 or start the simulator first";
  elements.simulateButton.disabled = busy || !simulated || !hasProfile || ui.stale;
  elements.simulateButton.title = simulated ? "Send a press through the simulator hardware path" : "Available only when the service runs in simulator mode";
  elements.triggerButton.disabled = busy || !hasProfile || ui.stale;
  elements.duplicateProfileButton.disabled = busy || !hasProfile || ui.stale;
  elements.deleteProfileButton.disabled = busy || profiles.length <= 1 || !hasProfile || ui.stale;
  elements.newProfileButton.disabled = busy || profiles.length >= 50 || ui.stale;
  elements.aiLayoutButton.disabled = busy || !hasProfile || ui.stale;
  elements.shortcutFile.disabled = busy || !hasProfile || ui.stale;
  elements.pasteCommandButton.disabled = busy || !hasProfile || ui.stale;
  elements.workspace.setAttribute("aria-busy", String(busy));
  document.body.classList.toggle("is-busy", busy);
}

function renderRecoveryNotice() {
  const notice = ui.serverState?.recoveryNotice;
  if (!notice || elements.recoveryNotice.dataset.dismissed === notice) {
    elements.recoveryNotice.hidden = true;
    return;
  }
  elements.recoveryNoticeText.textContent = notice;
  elements.recoveryNotice.hidden = false;
}

function formatRelativeTime(value) {
  if (!value) return "just now";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "recently";
  const seconds = Math.round((Date.now() - time) / 1000);
  if (Math.abs(seconds) < 10) return "just now";
  if (Math.abs(seconds) < 60) return `${Math.abs(seconds)}s ago`;
  const minutes = Math.round(Math.abs(seconds) / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(time));
}

function selectProfile(profileId) {
  if (!ui.draftConfig || ui.draftConfig.activeProfileId === profileId) return;
  if (!ui.draftConfig.profiles.some((profile) => profile.id === profileId)) return;
  ui.draftConfig.activeProfileId = profileId;
  ui.selectedKey = 1;
  markDirty();
  renderProfiles();
  renderDeck();
  renderInspector();
  renderRevision();
  renderOperation();
  renderControlAvailability();
}

function selectKey(index) {
  if (!Number.isInteger(index) || index < 1 || index > 18) return;
  ui.selectedKey = index;
  renderDeck();
  renderInspector();
}

function mutateSelectedKey(mutator, { deck = true } = {}) {
  const key = selectedKeyConfig();
  if (!key) return;
  mutator(key);
  markDirty();
  if (deck) renderDeck();
  renderRevision();
  renderOperation();
  renderControlAvailability();
}

function markDirty() {
  ui.dirty = true;
}

function clearActionErrors() {
  elements.actionError.textContent = "";
  for (const control of [elements.commandExecutable, elements.actionUrl, elements.targetProfile]) {
    control.removeAttribute("aria-invalid");
  }
}

function clearFieldError(control, errorElement) {
  control.removeAttribute("aria-invalid");
  control.removeAttribute("aria-describedby");
  errorElement.textContent = "";
}

function setFieldError(control, errorElement, message) {
  control.setAttribute("aria-invalid", "true");
  control.setAttribute("aria-describedby", errorElement.id);
  errorElement.textContent = message;
}

function validateDraft() {
  if (!ui.draftConfig) throw new UiValidationError("No configuration is loaded");
  if (!HEX_COLOR.test(ui.draftConfig.device.ledColor)) {
    throw new UiValidationError("The chassis LED color must be a six-digit hex color", {
      field: "ledColorText",
    });
  }

  const profileIds = new Set(ui.draftConfig.profiles.map((profile) => profile.id));
  for (const profile of ui.draftConfig.profiles) {
    if (!profile.name.trim()) {
      throw new UiValidationError("A profile name cannot be empty", { profileId: profile.id });
    }
    for (const key of profile.keys) {
      const location = { profileId: profile.id, key: key.index };
      if (!HEX_COLOR.test(key.color)) {
        throw new UiValidationError(`Key ${key.index} has an invalid color`, {
          ...location,
          field: "keyColorText",
        });
      }
      if (key.action.type === "command" && !key.action.executable?.trim()) {
        throw new UiValidationError(`Key ${key.index} needs an executable`, {
          ...location,
          field: "commandExecutable",
        });
      }
      if (key.action.type === "url") {
        let parsed;
        try {
          parsed = new URL(key.action.url);
        } catch {
          parsed = null;
        }
        if (!parsed || !new Set(["http:", "https:"]).has(parsed.protocol)) {
          throw new UiValidationError(`Key ${key.index} needs a valid HTTP or HTTPS address`, {
            ...location,
            field: "actionUrl",
          });
        }
      }
      if (key.action.type === "profile" && !profileIds.has(key.action.profileId)) {
        throw new UiValidationError(`Key ${key.index} points to a missing profile`, {
          ...location,
          field: "targetProfile",
        });
      }
    }
  }
  return true;
}

function revealValidationError(error) {
  if (error.profileId && ui.draftConfig.profiles.some((profile) => profile.id === error.profileId)) {
    ui.draftConfig.activeProfileId = error.profileId;
  }
  if (error.key) ui.selectedKey = error.key;
  renderProfiles();
  renderDeck();
  renderInspector();
  renderDeviceControls();
  const control = error.field ? byId(error.field) : null;
  if (control) {
    control.setAttribute("aria-invalid", "true");
    if (new Set(["commandExecutable", "actionUrl", "targetProfile"]).has(error.field)) {
      elements.actionError.textContent = error.message;
      control.setAttribute("aria-describedby", elements.actionError.id);
    }
    control.focus();
  }
  showToast({ tone: "error", title: "Check configuration", message: error.message });
}

async function persistDraft({ announce = false } = {}) {
  if (!ui.dirty) return ui.serverState;
  if (ui.stale) {
    const shouldReload = await askForConfirmation({
      kicker: "Revision conflict",
      title: "Reload current configuration?",
      message: "Another client saved a newer revision. Reloading is the safe option, but it will discard this unsaved draft.",
      confirmLabel: "Reload and discard",
      danger: true,
    });
    if (shouldReload) {
      await loadState();
      showToast({ tone: "success", title: "Configuration reloaded", message: "The current server revision is ready." });
    }
    return null;
  }

  try {
    validateDraft();
  } catch (error) {
    if (error instanceof UiValidationError) revealValidationError(error);
    else throw error;
    return null;
  }

  const response = await apiRequest("/api/config", {
    method: "PUT",
    json: {
      config: ui.draftConfig,
      expectedRevision: ui.serverState.config.revision,
    },
  });
  const nextState = stateFromResponse(response);
  if (!nextState) throw new Error("The controller returned an invalid configuration response");
  adoptServerState(nextState, { replaceDraft: true, source: "response" });
  if (announce) {
    showToast({ tone: "success", title: "Configuration saved", message: `Revision ${nextState.config.revision} is on disk.` });
  }
  return nextState;
}

function runMutation(message, operation) {
  const run = async () => {
    ui.busyCount += 1;
    ui.busyMessage = message;
    renderTransient();
    try {
      return await operation();
    } catch (error) {
      await handleMutationError(error);
      return null;
    } finally {
      ui.busyCount = Math.max(0, ui.busyCount - 1);
      if (ui.busyCount === 0) ui.busyMessage = "";
      renderTransient();
    }
  };
  const next = mutationTail.then(run, run);
  mutationTail = next.catch(() => undefined);
  return next;
}

async function handleMutationError(error) {
  if (error instanceof UiValidationError) {
    revealValidationError(error);
    return;
  }
  if (error instanceof ApiError && error.status === 409) {
    const hadDirtyDraft = ui.dirty;
    try {
      await loadState({ preserveDraft: hadDirtyDraft });
    } catch {
      // Keep the original revision error as the useful message.
    }
    ui.stale = hadDirtyDraft;
    showToast({
      tone: "error",
      title: "Configuration changed",
      message: hadDirtyDraft
        ? "A newer configuration is on disk. Your draft remains visible; reload before saving."
        : "The current configuration was reloaded. Review it before trying the operation again.",
      duration: 10000,
    });
    return;
  }
  showToast({
    tone: "error",
    title: "Operation failed",
    message: error?.message || "The local controller rejected the operation.",
    duration: 9000,
  });
}

function openProfileDialog(mode) {
  if (!activeProfile()) return;
  ui.profileDialogMode = mode;
  ui.dialogOpener = document.activeElement;
  const duplicate = mode === "duplicate";
  elements.profileDialogTitle.textContent = duplicate ? "Duplicate profile" : "Create profile";
  elements.profileDialogDescription.textContent = duplicate
    ? `Copy all 18 keys from “${activeProfile().name}”.`
    : "Start with a clean 18-button layout.";
  elements.submitProfileDialog.textContent = duplicate ? "Duplicate" : "Create";
  elements.profileName.value = duplicate ? `${activeProfile().name} Copy` : "New Profile";
  elements.profileDialogError.textContent = "";
  elements.profileName.removeAttribute("aria-invalid");
  elements.profileDialog.returnValue = "";
  elements.profileDialog.showModal();
  requestAnimationFrame(() => {
    elements.profileName.focus();
    elements.profileName.select();
  });
}

function closeProfileDialog() {
  if (elements.profileDialog.open) elements.profileDialog.close("cancel");
}

function askForConfirmation({ kicker = "Confirm operation", title, message, confirmLabel = "Continue", danger = false }) {
  if (elements.confirmDialog.open) return Promise.resolve(false);
  ui.confirmOpener = document.activeElement;
  elements.confirmDialogKicker.textContent = kicker;
  elements.confirmDialogTitle.textContent = title;
  elements.confirmDialogMessage.textContent = message;
  elements.confirmDialogButton.textContent = confirmLabel;
  elements.confirmDialog.dataset.danger = String(danger);
  elements.confirmDialogIndex.textContent = danger ? "!" : "OK";
  elements.confirmDialog.returnValue = "";
  elements.confirmDialog.showModal();
  requestAnimationFrame(() => elements.confirmDialogButton.focus());
  return new Promise((resolve) => {
    ui.confirmResolver = resolve;
  });
}

function showToast({ tone = "info", title, message, duration = 6000 }) {
  const toast = document.createElement("article");
  const glyph = document.createElement("span");
  const copyBlock = document.createElement("div");
  const heading = document.createElement("strong");
  const copyText = document.createElement("p");
  const closeButton = document.createElement("button");
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  let timer = null;
  let remaining = duration;
  let startedAt = 0;

  toast.className = "toast";
  toast.dataset.tone = tone;
  toast.setAttribute("role", tone === "error" ? "alert" : "status");
  glyph.className = "toast-glyph";
  glyph.textContent = tone === "success" ? "✓" : tone === "error" ? "!" : "i";
  glyph.setAttribute("aria-hidden", "true");
  copyBlock.className = "toast-copy";
  heading.textContent = title;
  copyText.textContent = message;
  copyBlock.append(heading, copyText);
  closeButton.type = "button";
  closeButton.className = "toast-close";
  closeButton.setAttribute("aria-label", `Dismiss ${title} notification`);
  icon.classList.add("icon");
  icon.setAttribute("aria-hidden", "true");
  use.setAttribute("href", "#icon-close");
  icon.append(use);
  closeButton.append(icon);
  toast.append(glyph, copyBlock, closeButton);
  elements.toastRegion.append(toast);

  const remove = () => {
    clearTimeout(timer);
    toast.remove();
  };
  const startTimer = () => {
    if (remaining <= 0 || document.activeElement === closeButton) return;
    startedAt = Date.now();
    timer = window.setTimeout(remove, remaining);
  };
  const pauseTimer = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    remaining -= Date.now() - startedAt;
  };
  closeButton.addEventListener("click", remove);
  toast.addEventListener("mouseenter", pauseTimer);
  toast.addEventListener("mouseleave", startTimer);
  toast.addEventListener("focusin", pauseTimer);
  toast.addEventListener("focusout", startTimer);
  startTimer();
}

function aiProviderPayload() {
  return {
    provider: elements.aiProvider.value,
    baseUrl: elements.aiEndpoint.value.trim(),
    apiKey: elements.aiApiKey.value,
  };
}

function renderAiProvider() {
  const provider = elements.aiProvider.value;
  const usesEndpoint = new Set(["ollama", "openai-compatible"]).has(provider);
  elements.aiEndpointField.hidden = !usesEndpoint;
  elements.aiApiKeyField.hidden = provider === "ollama";
  if (provider === "ollama" && (!/^https?:\/\//i.test(elements.aiEndpoint.value) || elements.aiEndpoint.value.includes(":1234"))) {
    elements.aiEndpoint.value = "http://127.0.0.1:11434";
  }
  if (provider === "openai-compatible" && (!/^https?:\/\//i.test(elements.aiEndpoint.value) || elements.aiEndpoint.value.includes(":11434"))) {
    elements.aiEndpoint.value = "http://127.0.0.1:1234/v1";
  }
  elements.aiModelList.replaceChildren();
  elements.aiModel.value = "";
  elements.aiModelHint.textContent = "Connect to the provider to see models available to this account or local server.";
  elements.aiDialogError.textContent = "";
}

function setAiBusy(busy, message = "") {
  ui.aiBusy = busy;
  elements.aiDialogForm.setAttribute("aria-busy", String(busy));
  elements.loadModelsButton.disabled = busy;
  elements.generateAiLayoutButton.disabled = busy;
  elements.acceptAiLayoutButton.disabled = busy || !ui.aiProposal;
  if (message) elements.aiModelHint.textContent = message;
}

function openAiDialog() {
  if (!activeProfile()) return;
  ui.aiDialogOpener = document.activeElement;
  ui.aiProposal = null;
  elements.aiDialogError.textContent = "";
  elements.aiPreview.hidden = true;
  elements.aiPreviewGrid.replaceChildren();
  elements.acceptAiLayoutButton.disabled = true;
  elements.aiDialog.returnValue = "";
  elements.aiDialog.showModal();
  renderAiProvider();
  requestAnimationFrame(() => elements.aiProvider.focus());
}

function closeAiDialog() {
  if (ui.aiBusy) return;
  if (elements.aiDialog.open) elements.aiDialog.close("cancel");
}

function renderAiPreview(proposal) {
  const fragment = document.createDocumentFragment();
  for (const key of proposal.layout.keys) {
    const tile = document.createElement("article");
    const number = document.createElement("span");
    const label = document.createElement("strong");
    const action = document.createElement("small");
    const color = normalizeColor(key.color);
    tile.className = `ai-preview-key${key.index > 15 ? " ai-preview-key-hardware" : ""}`;
    tile.style.setProperty("--key-color", color);
    tile.style.setProperty("--key-text", keyTextColor(color));
    number.textContent = padKey(key.index);
    label.textContent = key.label || "UNLABELED";
    action.textContent = actionLabel(key.action);
    tile.append(number, label, action);
    fragment.append(tile);
  }
  elements.aiPreviewSummary.textContent = proposal.layout.summary;
  elements.aiPreviewGrid.replaceChildren(fragment);
  elements.aiPreview.hidden = false;
  elements.acceptAiLayoutButton.disabled = false;
  elements.aiPreview.scrollIntoView({ block: "nearest" });
}

async function loadAiModels() {
  elements.aiDialogError.textContent = "";
  setAiBusy(true, "Loading models from the provider…");
  try {
    const response = await apiRequest("/api/ai/models", {
      method: "POST",
      json: aiProviderPayload(),
    });
    const models = Array.isArray(response?.models) ? response.models : [];
    if (!models.length) throw new Error("The provider returned no text-generation models. You can enter a model ID manually.");
    const fragment = document.createDocumentFragment();
    for (const model of models) {
      const option = document.createElement("option");
      option.value = model;
      fragment.append(option);
    }
    elements.aiModelList.replaceChildren(fragment);
    if (!elements.aiModel.value) elements.aiModel.value = models[0];
    elements.aiModelHint.textContent = `${models.length} available model${models.length === 1 ? "" : "s"} loaded. You can still enter another model ID.`;
  } catch (error) {
    elements.aiDialogError.textContent = error?.message || "Models could not be loaded.";
    elements.aiModelHint.textContent = "Model discovery failed; correct the connection or enter a model ID manually.";
  } finally {
    setAiBusy(false);
  }
}

async function generateAiLayout() {
  const model = elements.aiModel.value.trim();
  const prompt = elements.aiPrompt.value.trim();
  if (!model) {
    elements.aiDialogError.textContent = "Load or enter a model ID.";
    elements.aiModel.focus();
    return;
  }
  if (!prompt) {
    elements.aiDialogError.textContent = "Describe what you want the buttons to do.";
    elements.aiPrompt.focus();
    return;
  }
  elements.aiDialogError.textContent = "";
  elements.aiPreview.hidden = true;
  ui.aiProposal = null;
  setAiBusy(true, "Generating an 18-key draft…");
  try {
    const scope = elements.aiDialogForm.elements.aiScope.value === "empty" ? "empty" : "all";
    const response = await apiRequest("/api/ai/layout", {
      method: "POST",
      json: {
        ...aiProviderPayload(),
        model,
        prompt,
        scope,
        platform: runtimePlatform().label,
        profile: activeProfile(),
      },
    });
    if (!response?.layout?.keys) throw new Error("The provider returned an invalid layout response.");
    ui.aiProposal = { ...response, scope };
    renderAiPreview(ui.aiProposal);
    elements.aiModelHint.textContent = `Preview generated with ${response.model || model}. Nothing has been saved or applied.`;
  } catch (error) {
    elements.aiDialogError.textContent = error?.message || "The AI layout could not be generated.";
  } finally {
    setAiBusy(false);
  }
}

function acceptAiLayout() {
  const proposal = ui.aiProposal;
  const profile = activeProfile();
  if (!proposal?.layout?.keys || !profile) return;
  let changed = 0;
  for (const generated of proposal.layout.keys) {
    const key = profile.keys[generated.index - 1];
    if (!key) continue;
    if (proposal.scope === "empty" && key.action.type !== "none") continue;
    key.label = String(generated.label || "").slice(0, 32);
    key.color = normalizeColor(generated.color);
    key.action = clone(generated.action || { type: "none" });
    changed += 1;
  }
  if (!changed) {
    elements.aiDialogError.textContent = "No unassigned keys were available. Choose “Redesign all 18 keys” to replace the current layout.";
    return;
  }
  markDirty();
  renderAll();
  elements.aiDialog.close("accepted");
  showToast({
    tone: "success",
    title: "AI layout staged",
    message: `${changed} key${changed === 1 ? "" : "s"} updated as an unsaved draft. Review every command before applying.`,
    duration: 9000,
  });
}

function openPasteDialog(keyIndex, initialValue = "") {
  closeKeyContextMenu();
  ui.pasteDialogOpener = document.querySelector(`.deck-key[data-key="${keyIndex}"]`) || document.activeElement;
  ui.pasteTargetKey = keyIndex;
  elements.pasteDialogKey.textContent = padKey(keyIndex);
  elements.pastedCommand.value = initialValue;
  elements.pasteDialogError.textContent = "";
  elements.pasteDialog.returnValue = "";
  elements.pasteDialog.showModal();
  requestAnimationFrame(() => elements.pastedCommand.focus());
}

function closePasteDialog() {
  if (elements.pasteDialog.open) elements.pasteDialog.close("cancel");
}

async function pasteCommandForKey(keyIndex) {
  let text = "";
  try {
    text = await navigator.clipboard.readText();
  } catch {
    openPasteDialog(keyIndex);
    return;
  }
  if (!text.trim()) {
    openPasteDialog(keyIndex);
    return;
  }
  runMutation("Staging pasted command", () =>
    resolveAndStageShortcut({ targetKey: keyIndex, name: "Pasted command", content: text }),
  );
}

function flashKey(index) {
  const key = Number(index);
  if (!Number.isInteger(key) || key < 1 || key > 18) return;
  requestAnimationFrame(() => {
    const button = document.querySelector(`.deck-key[data-key="${key}"]`);
    if (!button) return;
    button.classList.remove("signal-flash");
    void button.offsetWidth;
    button.classList.add("signal-flash");
    window.setTimeout(() => button.classList.remove("signal-flash"), 520);
  });
}

function wireEvents() {
  elements.retryButton.addEventListener("click", () => {
    loadState()
      .then(connectEventStream)
      .catch(showInitialError);
  });

  elements.dismissRecovery.addEventListener("click", () => {
    elements.recoveryNotice.dataset.dismissed = ui.serverState?.recoveryNotice || "dismissed";
    elements.recoveryNotice.hidden = true;
  });

  elements.aiLayoutButton.addEventListener("click", openAiDialog);
  elements.aiProvider.addEventListener("change", renderAiProvider);
  elements.loadModelsButton.addEventListener("click", loadAiModels);
  elements.aiDialogForm.addEventListener("submit", (event) => {
    event.preventDefault();
    generateAiLayout();
  });
  elements.cancelAiDialog.addEventListener("click", closeAiDialog);
  elements.acceptAiLayoutButton.addEventListener("click", acceptAiLayout);
  elements.aiDialog.addEventListener("close", () => {
    ui.aiProposal = null;
    elements.aiApiKey.value = "";
    requestAnimationFrame(() => ui.aiDialogOpener?.focus?.());
    ui.aiDialogOpener = null;
  });

  elements.pasteCommandButton.addEventListener("click", () => pasteCommandForKey(ui.selectedKey));
  elements.pasteDialogForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = elements.pastedCommand.value.trim();
    if (!text) {
      elements.pasteDialogError.textContent = "Paste a command to assign.";
      elements.pastedCommand.focus();
      return;
    }
    const targetKey = ui.pasteTargetKey;
    closePasteDialog();
    runMutation("Staging pasted command", () =>
      resolveAndStageShortcut({ targetKey, name: "Pasted command", content: text }),
    );
  });
  elements.cancelPasteDialog.addEventListener("click", closePasteDialog);
  elements.pasteDialog.addEventListener("close", () => {
    requestAnimationFrame(() => ui.pasteDialogOpener?.focus?.());
    ui.pasteDialogOpener = null;
  });

  elements.contextPasteCommand.addEventListener("click", () => {
    const key = ui.contextKey || ui.selectedKey;
    closeKeyContextMenu();
    pasteCommandForKey(key);
  });
  elements.contextChooseShortcut.addEventListener("click", () => {
    const key = ui.contextKey || ui.selectedKey;
    closeKeyContextMenu();
    selectKey(key);
    elements.shortcutFile.click();
  });
  elements.contextClearAction.addEventListener("click", () => {
    const keyIndex = ui.contextKey || ui.selectedKey;
    closeKeyContextMenu();
    selectKey(keyIndex);
    mutateSelectedKey((key) => {
      key.action = { type: "none" };
    });
    renderInspector();
    showToast({ tone: "success", title: "Action cleared", message: `Key ${padKey(keyIndex)} is now unassigned in the draft.` });
  });
  elements.keyContextMenu.addEventListener("keydown", (event) => {
    const items = [...elements.keyContextMenu.querySelectorAll("button")];
    const current = items.indexOf(document.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      closeKeyContextMenu({ restoreFocus: true });
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      items[(current + direction + items.length) % items.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      items[event.key === "Home" ? 0 : items.length - 1]?.focus();
    }
  });

  elements.newProfileButton.addEventListener("click", () => openProfileDialog("create"));
  elements.duplicateProfileButton.addEventListener("click", () => openProfileDialog("duplicate"));
  elements.deleteProfileButton.addEventListener("click", async () => {
    const profile = activeProfile();
    if (!profile || ui.draftConfig.profiles.length <= 1) return;
    const confirmed = await askForConfirmation({
      kicker: "Destructive operation",
      title: `Delete “${profile.name}”?`,
      message: "This permanently removes the profile. Keys in other profiles that point to it will be reset to no action.",
      confirmLabel: "Delete profile",
      danger: true,
    });
    if (!confirmed) return;
    runMutation("Deleting profile", async () => {
      const saved = await persistDraft();
      if (!saved) return;
      const response = await apiRequest(`/api/profiles/${encodeURIComponent(profile.id)}`, {
        method: "DELETE",
        json: { expectedRevision: ui.serverState.config.revision },
      });
      const nextState = stateFromResponse(response);
      if (!nextState) throw new Error("The controller returned an invalid profile response");
      ui.selectedKey = 1;
      adoptServerState(nextState, { replaceDraft: true });
      showToast({ tone: "success", title: "Profile deleted", message: `“${profile.name}” was removed.` });
      requestAnimationFrame(() => elements.profileList.querySelector("button")?.focus());
    });
  });

  elements.profileDialogForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = elements.profileName.value.trim();
    if (!name) {
      elements.profileName.setAttribute("aria-invalid", "true");
      elements.profileName.setAttribute("aria-describedby", elements.profileDialogError.id);
      elements.profileDialogError.textContent = "Enter a profile name.";
      elements.profileName.focus();
      return;
    }
    const duplicateFrom = ui.profileDialogMode === "duplicate" ? activeProfile()?.id || null : null;
    closeProfileDialog();
    runMutation(ui.profileDialogMode === "duplicate" ? "Duplicating profile" : "Creating profile", async () => {
      const saved = await persistDraft();
      if (!saved) return;
      const response = await apiRequest("/api/profiles", {
        method: "POST",
        json: {
          name,
          duplicateFrom,
          expectedRevision: ui.serverState.config.revision,
        },
      });
      const nextState = stateFromResponse(response);
      if (!nextState) throw new Error("The controller returned an invalid profile response");
      ui.selectedKey = 1;
      adoptServerState(nextState, { replaceDraft: true });
      showToast({
        tone: "success",
        title: ui.profileDialogMode === "duplicate" ? "Profile duplicated" : "Profile created",
        message: `“${name}” is ready to edit.`,
      });
      requestAnimationFrame(() => {
        elements.profileList.querySelector(`[data-profile-id="${response.profile?.id || nextState.config.activeProfileId}"]`)?.focus();
      });
    });
  });
  elements.cancelProfileDialog.addEventListener("click", closeProfileDialog);
  elements.profileDialog.addEventListener("close", () => {
    ui.dialogOpener?.focus?.();
    ui.dialogOpener = null;
  });

  elements.confirmDialog.addEventListener("close", () => {
    const resolver = ui.confirmResolver;
    ui.confirmResolver = null;
    resolver?.(elements.confirmDialog.returnValue === "confirm");
    requestAnimationFrame(() => ui.confirmOpener?.focus?.());
    ui.confirmOpener = null;
  });

  elements.saveButton.addEventListener("click", () => {
    runMutation("Saving configuration", () => persistDraft({ announce: true }));
  });

  elements.applyButton.addEventListener("click", () => {
    runMutation("Saving and applying profile", async () => {
      const saved = await persistDraft();
      if (!saved) return;
      const response = await apiRequest("/api/device/apply", {
        method: "POST",
        json: {
          profileId: saved.config.activeProfileId,
          expectedRevision: saved.config.revision,
        },
      });
      const nextState = stateFromResponse(response);
      if (nextState) adoptServerState(nextState, { replaceDraft: true });
      const result = response?.result;
      showToast({
        tone: "success",
        title: "Profile applied",
        message: `${result?.keys ?? 15} LCD keys were written to the M18.`,
      });
    });
  });

  elements.simulateButton.addEventListener("click", () => {
    const keyIndex = ui.selectedKey;
    runMutation("Simulating hardware press", async () => {
      const saved = await persistDraft();
      if (!saved) return;
      const snapshot = executionSnapshot(saved, keyIndex);
      const action = snapshot.expectedAction;
      if (new Set(["command", "url"]).has(action.type)) {
        const confirmed = await askForConfirmation({
          kicker: "External action",
          title: `Simulate key ${keyIndex}?`,
          message: `The simulator follows the hardware path and will ${action.type === "url" ? "open a web address" : "launch a command"}: ${actionSummary(action)}`,
          confirmLabel: "Simulate and launch",
        });
        if (!confirmed) return;
      }
      const response = await apiRequest("/api/device/simulate", {
        method: "POST",
        json: { key: keyIndex, confirm: true, ...snapshot },
      });
      const nextState = stateFromResponse(response);
      if (nextState) adoptServerState(nextState, { source: "response" });
      flashKey(keyIndex);
      showToast({ tone: "success", title: "Input simulated", message: `Key ${padKey(keyIndex)} entered the hardware signal path.` });
    });
  });

  elements.triggerButton.addEventListener("click", () => {
    const keyIndex = ui.selectedKey;
    runMutation("Testing selected action", async () => {
      const saved = await persistDraft();
      if (!saved) return;
      const snapshot = executionSnapshot(saved, keyIndex);
      const action = snapshot.expectedAction;
      let confirm = false;
      if (new Set(["command", "url"]).has(action.type)) {
        confirm = await askForConfirmation({
          kicker: "External action",
          title: `Run key ${keyIndex}?`,
          message: `${actionLabel(action)}: ${actionSummary(action)}`,
          confirmLabel: action.type === "url" ? "Open address" : "Run command",
        });
        if (!confirm) return;
      }
      const response = await apiRequest("/api/actions/trigger", {
        method: "POST",
        json: { key: keyIndex, confirm, ...snapshot },
      });
      const nextState = stateFromResponse(response);
      if (nextState) adoptServerState(nextState, { replaceDraft: true });
      flashKey(keyIndex);
      showToast({
        tone: "success",
        title: "Action tested",
        message: response?.result?.result?.reason || `${actionLabel(action)} completed for key ${padKey(keyIndex)}.`,
      });
    });
  });

  elements.keyForm.addEventListener("submit", (event) => event.preventDefault());
  elements.keyLabel.addEventListener("input", () => {
    mutateSelectedKey((key) => {
      key.label = elements.keyLabel.value;
    });
    elements.labelCount.textContent = String(elements.keyLabel.value.length);
    elements.previewLabel.textContent = elements.keyLabel.value || "UNLABELED";
  });

  elements.keyColor.addEventListener("input", () => {
    const color = elements.keyColor.value.toUpperCase();
    elements.keyColorText.value = color;
    clearFieldError(elements.keyColorText, elements.colorError);
    mutateSelectedKey((key) => {
      key.color = color;
    });
    elements.inspectorPreview.style.setProperty("--key-color", color);
    const hasArtwork = Boolean(selectedKeyConfig()?.assetId && ui.selectedKey <= 15);
    elements.inspectorPreview.style.setProperty("--key-text", hasArtwork ? "#FFFFFF" : keyTextColor(color));
    elements.inspectorPreview.style.setProperty("--key-shadow", hasArtwork ? "0 1px 2px rgb(0 0 0 / 82%)" : keyTextShadow(color));
  });

  elements.keyColorText.addEventListener("input", () => {
    const color = elements.keyColorText.value.toUpperCase();
    elements.keyColorText.value = color;
    if (!HEX_COLOR.test(color)) {
      setFieldError(elements.keyColorText, elements.colorError, "Use # followed by six hexadecimal digits.");
      return;
    }
    clearFieldError(elements.keyColorText, elements.colorError);
    elements.keyColor.value = color;
    mutateSelectedKey((key) => {
      key.color = color;
    });
    elements.inspectorPreview.style.setProperty("--key-color", color);
    const hasArtwork = Boolean(selectedKeyConfig()?.assetId && ui.selectedKey <= 15);
    elements.inspectorPreview.style.setProperty("--key-text", hasArtwork ? "#FFFFFF" : keyTextColor(color));
    elements.inspectorPreview.style.setProperty("--key-shadow", hasArtwork ? "0 1px 2px rgb(0 0 0 / 82%)" : keyTextShadow(color));
  });

  elements.actionType.addEventListener("change", () => {
    const type = elements.actionType.value;
    mutateSelectedKey((key) => {
      if (type === "command") key.action = { type, executable: "", args: [] };
      else if (type === "url") key.action = { type, url: "" };
      else if (type === "profile") {
        key.action = { type, profileId: ui.draftConfig.profiles[0]?.id || "" };
      } else key.action = { type: "none" };
    });
    renderInspector();
  });

  elements.commandExecutable.addEventListener("input", () => {
    clearActionErrors();
    mutateSelectedKey((key) => {
      if (key.action.type === "command") key.action.executable = elements.commandExecutable.value;
    });
  });

  elements.commandArgs.addEventListener("input", () => {
    mutateSelectedKey((key) => {
      if (key.action.type !== "command") return;
      key.action.args = elements.commandArgs.value === "" ? [] : elements.commandArgs.value.split(/\r?\n/);
    });
  });

  elements.actionUrl.addEventListener("input", () => {
    clearActionErrors();
    mutateSelectedKey((key) => {
      if (key.action.type === "url") key.action.url = elements.actionUrl.value;
    });
  });

  elements.targetProfile.addEventListener("change", () => {
    clearActionErrors();
    mutateSelectedKey((key) => {
      if (key.action.type === "profile") key.action.profileId = elements.targetProfile.value;
    });
  });

  elements.shortcutFile.addEventListener("change", () => {
    const [file] = elements.shortcutFile.files || [];
    if (!file) return;
    const targetKey = ui.selectedKey;
    runMutation("Reading shortcut", () => stageDroppedFile(file, targetKey)).finally(() => {
      elements.shortcutFile.value = "";
    });
  });

  elements.imageUpload.addEventListener("change", () => {
    const [file] = elements.imageUpload.files || [];
    if (!file) return;
    const targetKey = ui.selectedKey;
    runMutation("Uploading key image", () => stageImageFile(file, targetKey)).finally(() => {
      elements.imageUpload.value = "";
    });
  });

  elements.removeImageButton.addEventListener("click", () => {
    mutateSelectedKey((key) => {
      key.assetId = null;
    });
    renderInspector();
  });

  elements.brightnessRange.addEventListener("input", () => {
    const value = Number(elements.brightnessRange.value);
    elements.brightnessOutput.value = `${value}%`;
    elements.brightnessOutput.textContent = `${value}%`;
    ui.draftConfig.device.brightness = value;
    markDirty();
    renderRevision();
    renderOperation();
    renderControlAvailability();
  });

  elements.ledColor.addEventListener("input", () => {
    const color = elements.ledColor.value.toUpperCase();
    elements.ledColorText.value = color;
    ui.draftConfig.device.ledColor = color;
    markDirty();
    renderRevision();
    renderOperation();
    renderControlAvailability();
  });

  elements.ledColorText.addEventListener("input", () => {
    const color = elements.ledColorText.value.toUpperCase();
    elements.ledColorText.value = color;
    elements.ledColorText.toggleAttribute("aria-invalid", !HEX_COLOR.test(color));
    if (!HEX_COLOR.test(color)) return;
    elements.ledColor.value = color;
    ui.draftConfig.device.ledColor = color;
    markDirty();
    renderRevision();
    renderOperation();
    renderControlAvailability();
  });

  elements.deviceControlsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const brightness = Number(elements.brightnessRange.value);
    const color = elements.ledColorText.value.toUpperCase();
    if (!HEX_COLOR.test(color)) {
      elements.ledColorText.setAttribute("aria-invalid", "true");
      elements.ledColorText.focus();
      showToast({ tone: "error", title: "Invalid LED color", message: "Use # followed by six hexadecimal digits." });
      return;
    }
    runMutation("Updating brightness and LEDs", async () => {
      const saved = await persistDraft();
      if (!saved) return;
      const brightnessResponse = await apiRequest("/api/device/brightness", {
        method: "POST",
        json: { value: brightness, expectedRevision: ui.serverState.config.revision },
      });
      const brightnessState = stateFromResponse(brightnessResponse);
      if (!brightnessState) throw new Error("The brightness response was invalid");
      adoptServerState(brightnessState, { replaceDraft: true });

      const ledResponse = await apiRequest("/api/device/led", {
        method: "POST",
        json: { color, expectedRevision: ui.serverState.config.revision },
      });
      const ledState = stateFromResponse(ledResponse);
      if (!ledState) throw new Error("The LED response was invalid");
      adoptServerState(ledState, { replaceDraft: true });
      const connected = ledState.device?.state === "connected";
      showToast({
        tone: "success",
        title: connected ? "Hardware updated" : "Hardware settings saved",
        message: `${brightness}% LCD brightness · ${color} chassis LED`,
      });
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.keyContextMenu.hidden) {
      closeKeyContextMenu({ restoreFocus: true });
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (!elements.saveButton.disabled) elements.saveButton.click();
    }
  });

  document.addEventListener("pointerdown", (event) => {
    if (!elements.keyContextMenu.hidden && !elements.keyContextMenu.contains(event.target)) {
      closeKeyContextMenu();
    }
  });
  window.addEventListener("resize", () => closeKeyContextMenu());
  window.addEventListener("scroll", () => closeKeyContextMenu(), true);

  window.addEventListener("beforeunload", (event) => {
    if (!ui.dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

async function initialize() {
  wireEvents();
  try {
    await loadState();
    connectEventStream();
  } catch (error) {
    showInitialError(error);
  }
}

initialize();
