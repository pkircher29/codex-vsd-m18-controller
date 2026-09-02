# M18 Foundry

M18 Foundry is a Linux and Windows setup and automation controller for the 18-button VSDinside and Mirabox M18 Stream Dock. It provides a local browser workspace, ordered control pages, native 64x64 LCD artwork, brightness and LED controls, a hardware-safe HID transport, a simulator, and an MCP server with a companion Codex skill.

New installations open a three-step first-run guide that checks the USB connection, prepares the first control page, and can perform the first safe display apply. See [HELP.md](./HELP.md) for operator guidance and [SPEC.md](./SPEC.md) for the product, configuration, API, and HID contracts.

Supported USB identities:

- VSDinside M18 — `5548:1000`
- Mirabox M18 — `6603:1009`
- Mirabox M18 EN — `6603:1012`

Each page contains 15 LCD controls with labels or uploaded artwork. The three lower non-display buttons are always **Back**, **Home**, and **Next**: Back and Next cycle through the ordered pages, while Home returns directly to page 1. LCD actions may launch an executable with an exact argument list, open an HTTP(S) URL, jump directly to another page, or do nothing. Commands are spawned directly without a shell.

## Build a layout

- Set a label and full-face color in the key inspector. LCD colors and labels are rendered into the 64×64 artwork sent to the dock.
- Drop a Linux `.desktop` shortcut, an internet `.url`/`.webloc` shortcut, a direct executable path, a web address, or an image onto a key. **Choose shortcut** provides the same workflow without dragging.
- Right-click a key (or press `Shift+F10`) and choose **Paste command** to split a copied command into an executable and exact argument list. Assignment never runs the command and remains a draft until Save or Apply.
- Choose **Design with AI** to generate and preview a 15-control page from a plain-language request. The three navigation buttons remain reserved. M18 Foundry can discover models from Ollama, OpenRouter, OpenAI, Anthropic, Gemini, or any standard OpenAI-compatible local/hosted endpoint (including LM Studio-style local servers and multi-provider gateways).
- **OpenRouter OAuth** uses its localhost PKCE flow and needs no app registration. **Google OAuth** uses a Google Desktop OAuth client ID plus the Cloud project that owns Gemini API quota. OAuth provider tokens stay only in the running controller process; the browser receives an opaque local connection ID. API-key authentication remains available for every supported direct API.

Cloud chat subscriptions do not automatically provide API access. OpenRouter sign-in uses OpenRouter credits or BYOK settings, Google sign-in uses Gemini API quota and billing for the chosen Cloud project, and the direct OpenAI and Anthropic APIs still require their documented API credentials. AI output is treated as untrusted draft data: commands are constrained to direct executable/argument actions, validated locally, previewed before acceptance, and never executed by the generation flow.

## Try it safely

Node.js 20.9.0 or newer is required.

```bash
cd codex-vsd-m18-controller
npm ci
npm run demo
```

The demo opens the complete application against an in-memory M18 simulator. It does not access USB hardware. If a browser does not open, run `node scripts/open-controller.js` from another terminal; the launcher discovers the private local instance and opens its authenticated URL.

The first-run guide appears for a fresh configuration. Choose **Skip for now** to explore without completing it, or finish the guide to save the first page name and optional auto-apply preference. You can reopen it later with **Setup guide** in the workspace footer.

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

The plugin manifest registers the local `vsdM18` stdio server from [`.mcp.json`](./.mcp.json). The server exposes 11 focused tools for status, stored pages (called profiles in the API), key assignments, display application, lighting, and explicitly authorized button triggers. Apply and trigger calls are bound to the page and revision that the caller inspected; triggers also verify the exact action immediately before launch.

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
- LCD presses execute the last fully applied page snapshot. Newly saved actions cannot silently outrun old key artwork, and action presses are blocked during or before a complete apply.
- Physical keys 16-18 are reserved for previous-page, page-1, and next-page navigation. Legacy bindings on these keys are normalized to navigation and cannot execute.
- Native 64x64 JPEGs are size-bounded, baseline encoded, and include a JFIF marker for firmware compatibility.
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

Tests cover exact packet framing and key mapping, reserved page navigation, native image rendering, serialized HID writes, configuration validation and recovery, simulator application, action confirmation, loopback API protections, and a real MCP initialize/list/call exchange.

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
