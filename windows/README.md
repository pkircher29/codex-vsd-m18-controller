# Windows installation

For normal installation, download the x64 setup executable from the [GitHub Releases page](https://github.com/pkircher29/codex-vsd-m18-controller/releases/latest). The NSIS installer includes the application runtime, installs for the current Windows user, and creates Start Menu and desktop shortcuts. It does not require Node.js or npm. The release is currently unsigned, so verify its SHA-256 value against `SHA256SUMS.txt` before running it.

The PowerShell workflow below remains available for source checkouts. It requires Windows 10 or 11, Windows PowerShell 5.1 or newer, and Node.js 20.9.0 or newer.

From a PowerShell prompt in the project directory, run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1
```

The source installer copies the runtime to `%LOCALAPPDATA%\Programs\M18Foundry`, runs `npm ci --omit=dev` against the lockfile, and creates a **M18 Foundry** Start Menu shortcut. Installation does not require elevation, install a device driver, or start the controller automatically.

Useful options:

```powershell
# Install and open the local controller after installation.
.\scripts\install-windows.ps1 -Launch

# Explicitly opt in to a per-user Startup-folder shortcut.
.\scripts\install-windows.ps1 -EnableAutoStart

# Keep the installation but remove its login startup shortcut.
.\scripts\install-windows.ps1 -DisableAutoStart

# Remove the installed runtime and shortcuts, preserving profiles and artwork.
& "$env:LOCALAPPDATA\Programs\M18Foundry\scripts\install-windows.ps1" -Uninstall

# Also remove the controller's saved profiles and uploaded artwork.
& "$env:LOCALAPPDATA\Programs\M18Foundry\scripts\install-windows.ps1" -Uninstall -PurgeData
```

Re-running the installer builds a clean staging copy with `npm ci`, stops only the launcher-owned controller process after verifying its process identity, and replaces the prior installation. If replacement fails, the previous verified installation is restored. An existing destination is never overwritten or removed unless its ownership marker identifies the exact M18 Foundry install path. The login auto-start choice is preserved unless an enable or disable switch is supplied.

The Start Menu launcher starts `src/server.js --headless` in a hidden process on an operating-system-assigned loopback port. It reads the private per-user instance descriptor, authenticates the health check with the instance capability token, and opens the authenticated UI in the default browser. Process metadata and launcher errors are stored under `%LOCALAPPDATA%\M18Foundry\runtime`.

Every API, artwork, and live-event request requires that random per-launch token. The browser moves it from the initial URL into session storage and removes it from the address bar. This allows separate signed-in Windows users to run independent controllers without trusting a shared fixed loopback port.

Auto-start is intentionally opt-in: a hardware controller should not begin running at every login without the user's explicit choice. It uses the current user's Startup folder and never requests elevation.

## Current platform tradeoffs

- No driver package is installed. The controller relies on Windows HID access and will ask the user to close other dock software if that interface is already claimed.
- Login startup is a per-user Startup-folder shortcut, not a Windows service. It starts after sign-in, stops at sign-out, and does not add a machine-wide crash-restart policy.
- Reinstall and uninstall stop only a process created and uniquely tagged by this launcher. PID, exact Node executable, server path, launch marker, and process creation time must all match. A controller started manually from a terminal must be closed manually before maintenance continues.
- Shortcut commands use process-scoped `-ExecutionPolicy Bypass` for the one installed launcher script. The installer does not change the user's or machine's persistent PowerShell execution policy.
- Configuration is stored in `%APPDATA%\M18Foundry`; artwork is stored in `%LOCALAPPDATA%\M18Foundry\assets`. Both are preserved by default during uninstall and removed only with `-PurgeData`.
