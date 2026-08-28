import { spawn } from "node:child_process";
import { win32 } from "node:path";

const WINDOWS_DEVICE_EVENT_SCRIPT = [
  "$source = 'M18FoundryDeviceChange'",
  "Register-CimIndicationEvent -ClassName Win32_DeviceChangeEvent -SourceIdentifier $source | Out-Null",
  "try {",
  "  while ($true) {",
  "    $event = Wait-Event -SourceIdentifier $source",
  "    Remove-Event -EventIdentifier $event.EventIdentifier",
  "    [Console]::Out.WriteLine('change')",
  "    [Console]::Out.Flush()",
  "  }",
  "} finally {",
  "  Unregister-Event -SourceIdentifier $source -ErrorAction SilentlyContinue",
  "}",
].join("\n");

export function platformLabel(platform = process.platform) {
  return {
    linux: "Linux",
    win32: "Windows",
    darwin: "macOS",
  }[platform] || platform;
}

export function runtimeInfo(platform = process.platform) {
  return {
    platform,
    platformLabel: platformLabel(platform),
  };
}

export function windowsPowerShellPath(env = process.env) {
  const windowsRoot = env.SystemRoot || env.WINDIR;
  return windowsRoot
    ? win32.join(windowsRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "powershell.exe";
}

export function externalOpenSpec(target, { platform = process.platform, env = process.env } = {}) {
  if (typeof target !== "string" || target.length === 0 || target.includes("\0")) {
    throw new TypeError("The external target must be non-empty text");
  }
  if (platform === "win32") {
    return {
      executable: windowsPowerShellPath(env),
      args: [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-Command",
        "Start-Process -FilePath $env:VSD_M18_OPEN_TARGET",
      ],
      env: { ...env, VSD_M18_OPEN_TARGET: target },
    };
  }
  if (platform === "linux") {
    return { executable: "xdg-open", args: [target], env };
  }
  if (platform === "darwin") {
    return { executable: "open", args: [target], env };
  }
  throw new Error(`Opening external targets is not supported on ${platformLabel(platform)}`);
}

export function deviceEventMonitorSpec({ platform = process.platform, env = process.env } = {}) {
  if (platform === "linux") {
    return {
      executable: "udevadm",
      args: ["monitor", "--udev", "--subsystem-match=hidraw", "--property"],
      env,
    };
  }
  if (platform === "win32") {
    return {
      executable: windowsPowerShellPath(env),
      args: [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-Command",
        WINDOWS_DEVICE_EVENT_SCRIPT,
      ],
      env,
    };
  }
  return null;
}

export function launchDetached(
  { executable, args = [], env = process.env },
  { spawnImplementation = spawn } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawnImplementation(executable, args, {
      detached: true,
      env,
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve({ pid: child.pid });
    });
  });
}

export function openExternal(target, options = {}) {
  const spec = externalOpenSpec(target, options);
  return launchDetached(spec, options);
}
