const { fork } = require("node:child_process");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, dialog, session, shell } = require("electron");

const APP_ID = "com.pkircher.m18foundry";
const OAUTH_WINDOW_NAME = "m18-ai-oauth";

let controllerHandle = null;
let mainWindow = null;
let quitting = false;

function isLocalControllerUrl(value, descriptor) {
  try {
    const candidate = new URL(value);
    const host = descriptor.host === "::1" ? "[::1]" : descriptor.host;
    return candidate.origin === `http://${host}:${descriptor.port}`;
  } catch {
    return false;
  }
}

function secureWindowOptions() {
  return {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
  };
}

function configureWebContents(contents, descriptor, { main = false } = {}) {
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url, frameName }) => {
    if (frameName === OAUTH_WINDOW_NAME && (url === "about:blank" || /^https?:\/\//i.test(url))) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          width: 620,
          height: 760,
          webPreferences: secureWindowOptions(),
        },
      };
    }
    if (isLocalControllerUrl(url, descriptor)) return { action: "allow" };
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  if (main) {
    contents.on("will-navigate", (event, url) => {
      if (isLocalControllerUrl(url, descriptor)) return;
      event.preventDefault();
      if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    });
  }
}

function createMainWindow(descriptor, uiUrl) {
  const window = new BrowserWindow({
    title: "M18 Foundry",
    width: 1360,
    height: 900,
    minWidth: 980,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#171a17",
    webPreferences: secureWindowOptions(),
  });
  configureWebContents(window.webContents, descriptor, { main: true });
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    mainWindow = null;
  });
  void window.loadURL(uiUrl);
  return window;
}

async function healthyDescriptor(descriptor, appVersion, instanceBaseUrl) {
  if (!descriptor) return null;
  try {
    const response = await fetch(`${instanceBaseUrl(descriptor)}/api/health`, {
      headers: { "X-VSD-Instance-Token": descriptor.token },
      signal: AbortSignal.timeout(750),
    });
    if (!response.ok) return null;
    const health = await response.json();
    return health.ok === true && health.version === appVersion && health.pid === descriptor.pid
      ? descriptor
      : null;
  } catch {
    return null;
  }
}

function stopControllerChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(forceTimer);
      resolve();
    };
    const forceTimer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(finish, 1_500).unref();
    }, 2_000);
    forceTimer.unref();
    child.once("exit", finish);
    if (child.connected) child.send({ type: "vsd-m18:shutdown" });
    else child.kill("SIGTERM");
  });
}

async function startControllerProcess() {
  const instanceUrl = pathToFileURL(path.join(__dirname, "..", "src", "instance-session.js")).href;
  const constantsUrl = pathToFileURL(path.join(__dirname, "..", "src", "constants.js")).href;
  const [{ instanceBaseUrl, instanceUiUrl, readInstanceDescriptor }, { APP_VERSION }] = await Promise.all([
    import(instanceUrl),
    import(constantsUrl),
  ]);
  const existing = await healthyDescriptor(
    await readInstanceDescriptor(),
    APP_VERSION,
    instanceBaseUrl,
  );
  if (existing) {
    return { descriptor: existing, reused: true, stop: async () => undefined, instanceUiUrl };
  }

  const serverEntry = path.join(__dirname, "..", "src", "server.js");
  const serverArguments = ["--headless"];
  if (process.argv.includes("--mock")) serverArguments.push("--mock");
  const child = fork(serverEntry, serverArguments, {
    cwd: path.join(__dirname, ".."),
    execPath: process.execPath,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      VSD_M18_NO_BROWSER: "1",
    },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
    windowsHide: true,
  });
  let diagnostics = "";
  child.stderr?.on("data", (chunk) => {
    diagnostics = `${diagnostics}${chunk}`.slice(-4_000);
  });

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const descriptor = await healthyDescriptor(
      await readInstanceDescriptor(),
      APP_VERSION,
      instanceBaseUrl,
    );
    if (descriptor) {
      const reused = descriptor.pid !== child.pid;
      return {
        descriptor,
        reused,
        stop: reused ? async () => undefined : () => stopControllerChild(child),
        instanceUiUrl,
      };
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(diagnostics.trim() || "The controller process exited before becoming ready.");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await stopControllerChild(child);
  throw new Error(diagnostics.trim() || "The controller process did not become ready in time.");
}

async function startDesktop() {
  controllerHandle = await startControllerProcess();
  mainWindow = createMainWindow(
    controllerHandle.descriptor,
    controllerHandle.instanceUiUrl(controllerHandle.descriptor),
  );
}

app.enableSandbox();
app.setAppUserModelId(APP_ID);

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
      const allowed = Boolean(
        controllerHandle &&
        isLocalControllerUrl(contents.getURL(), controllerHandle.descriptor) &&
        new Set(["clipboard-read", "clipboard-sanitized-write"]).has(permission)
      );
      callback(allowed);
    });
    await startDesktop();
  }).catch((error) => {
    dialog.showErrorBox("M18 Foundry could not start", error?.message || String(error));
    app.quit();
  });
}

app.on("window-all-closed", () => app.quit());

app.on("before-quit", (event) => {
  if (quitting || !controllerHandle || controllerHandle.reused) return;
  event.preventDefault();
  quitting = true;
  controllerHandle.stop("desktop exit")
    .catch(() => undefined)
    .finally(() => app.quit());
});
