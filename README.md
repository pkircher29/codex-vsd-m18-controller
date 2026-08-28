# M18 Foundry

M18 Foundry is a Linux and Windows setup and automation controller for the 18-button VSDinside and Mirabox M18 Stream Dock. It provides a local browser workspace, persistent profiles, native 64x64 LCD artwork, brightness and LED controls, a hardware-safe HID transport, a simulator, and an MCP server with a companion Codex skill.

Supported USB identities:

- VSDinside M18 — `5548:1000`
- Mirabox M18 — `6603:1009`
- Mirabox M18 EN — `6603:1012`

The 15 LCD keys can show labels or uploaded artwork. The three lower buttons can run actions but do not have displays. Actions may launch an executable with an exact argument list, open an HTTP(S) URL, switch profiles, or do nothing. Commands are spawned directly without a shell.

## Try it safely

Node.js 20.9.0 or newer is required.

```bash
cd codex-vsd-m18-controller
npm ci
npm run demo
```

The demo opens the complete application against an in-memory M18 simulator. It does not access USB hardware. If a browser does not open, run `node scripts/open-controller.js` from another terminal; the launcher discovers the private local instance and opens its authenticated URL.

## Linux installation

```bash
cd codex-vsd-m18-controller
./scripts/install-linux.sh
```

The installer:

1. installs the locked npm dependencies;
2. installs exact-device udev rules using `0660` and desktop-seat access;
3. adds a hardened systemd user service; and
4. adds an **M18 Foundry** application launcher.

Only the udev-rule step uses `sudo`. Unplug and reconnect the M18 once afterward, then open M18 Foundry from the application menu. The project never installs a world-writable HID rule.

To run without installing the service:

```bash
npm start
```

## Windows installation

Windows 10 or 11 and Windows PowerShell 5.1 or newer are supported. From a PowerShell prompt in the project directory:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1 -Launch
```

The per-user installer copies the locked runtime to `%LOCALAPPDATA%\Programs\M18Foundry`, installs dependencies with `npm ci`, and creates a Start Menu shortcut. It does not require Administrator access or install a driver. Login auto-start is available only through the explicit `-EnableAutoStart` option.

See [windows/README.md](./windows/README.md) for upgrade, auto-start, uninstall, data-retention, and troubleshooting details.

## MCP server and Codex skill

The plugin manifest registers the local `vsdM18` stdio server from [`.mcp.json`](./.mcp.json). The server exposes 11 focused tools for status, profiles, key assignments, display application, lighting, and explicitly authorized button triggers. Apply and trigger calls are bound to the profile and revision that the caller inspected; triggers also verify the exact action immediately before launch.

The companion skill is at [`skills/vsd-m18-control/SKILL.md`](./skills/vsd-m18-control/SKILL.md). It requires a status read before mutation, uses optimistic revisions to prevent lost updates, separates configuration from hardware application, and will not infer permission to execute commands or delete profiles.

Run the MCP server directly when integrating it with another client:

```bash
npm run mcp
```

Its stdout is reserved for MCP messages. Diagnostics go to stderr.

## Data and recovery

| Data | Linux | Windows |
|---|---|---|
| Configuration | `${XDG_CONFIG_HOME:-~/.config}/vsd-m18-controller/config.json` | `%APPDATA%\M18Foundry\config.json` |
| Last-known-good backup | `config.json.bak` beside the configuration | `config.json.bak` beside the configuration |
| Uploaded artwork | `${XDG_DATA_HOME:-~/.local/share}/vsd-m18-controller/assets/` | `%LOCALAPPDATA%\M18Foundry\assets\` |
| Runtime descriptor | `${XDG_RUNTIME_DIR}/vsd-m18-controller/instance.json`, or the configuration directory's `runtime/` fallback | `%LOCALAPPDATA%\M18Foundry\runtime\instance.json` |

Configuration changes use revision checks. Each save writes and syncs a private temporary file before an atomic rename. If the primary configuration becomes unreadable, startup restores the backup and reports the recovery in the UI and MCP status.

The HTTP service binds to an operating-system-assigned loopback port by default, validates Host and Origin headers, applies a restrictive content-security policy, limits uploads and request bodies, and requires a local-client marker for mutations. Each process publishes a private per-user descriptor and requires its random capability token on every API request. The browser removes that token from the address bar after placing it in session storage. This prevents another signed-in user sharing the same Windows or Linux host from controlling the dock through a guessed loopback port.

## Hardware-safety design

- Only supported VID/PID pairs and the vendor HID usage interface are opened; the M18 boot-keyboard interface is excluded.
- Output reports are fixed-size and short writes fail the connection.
- Complete JPEG transfers are placed on one write queue, so heartbeats and other commands cannot interleave with image data.
- Physical presses execute the last fully applied profile snapshot. Newly saved actions cannot silently outrun old key artwork, and presses are blocked during or before a complete apply.
- Native 64x64 JPEGs are size-bounded and include a JFIF marker for firmware compatibility.
- Key-image commit behavior is selected per known product revision.
- Linux hotplug uses udev events and Windows uses native device-change events, with a slow reconciliation scan only as a fallback.
- No API flashes firmware or accepts arbitrary HID packets.

Protocol compatibility was independently implemented from the [official Mirabox Device SDK](https://github.com/MiraboxSpace/StreamDock-Device-SDK), [Bitfocus Companion's Mirabox surface](https://github.com/bitfocus/companion-surface-mirabox-stream-dock), and [OpenDeck M18](https://github.com/ibanks42/opendeck-m18). See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for licenses and attribution.

## Development

```bash
npm run check
npm test
npm run verify
```

Tests cover exact packet framing and key mapping, native image rendering, serialized HID writes, configuration validation and recovery, simulator application, action confirmation, loopback API protections, and a real MCP initialize/list/call exchange.

Useful environment variables:

| Variable | Values | Purpose |
|---|---|---|
| `VSD_M18_MODE` | `auto`, `real`, `mock` | Select real-device discovery or the simulator. |
| `VSD_M18_HOST` | IP/host | Override the loopback bind host. |
| `VSD_M18_PORT` | integer | Override the operating-system-assigned loopback port. |
| `VSD_M18_CONFIG_HOME` | path | Override the application-specific configuration directory. |
| `VSD_M18_DATA_HOME` | path | Override the application-specific data directory. |
| `VSD_M18_RUNTIME_HOME` | path | Override the private runtime descriptor directory. |
| `VSD_M18_NO_BROWSER` | `1` | Do not launch a browser at startup. |

This is a controller and setup utility, not a firmware flasher. On Linux, real-device writes should begin only after the least-privilege udev rule is installed and the unit has been reconnected. On Windows, close other dock software before connecting so only one application owns the vendor HID interface.
