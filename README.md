# M18 Foundry

M18 Foundry is a Linux setup and automation controller for the 18-button VSDinside and Mirabox M18 Stream Dock. It provides a local browser workspace, persistent profiles, native 64x64 LCD artwork, brightness and LED controls, a hardware-safe HID transport, a simulator, and an MCP server with a companion Codex skill.

Supported USB identities:

- VSDinside M18 — `5548:1000`
- Mirabox M18 — `6603:1009`
- Mirabox M18 EN — `6603:1012`

The 15 LCD keys can show labels or uploaded artwork. The three lower buttons can run actions but do not have displays. Actions may launch an executable with an exact argument list, open an HTTP(S) URL, switch profiles, or do nothing. Commands are spawned directly without a shell.

## Try it safely

Node.js 20 or newer is required.

```bash
cd /home/paul/codex-vsd-m18-controller
npm ci
npm run demo
```

The demo opens the complete application against an in-memory M18 simulator. It does not access USB hardware. If a browser does not open, visit <http://127.0.0.1:31918>.

## Install for the real dock

```bash
cd /home/paul/codex-vsd-m18-controller
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

## MCP server and Codex skill

The plugin manifest registers the local `vsdM18` stdio server from [`.mcp.json`](./.mcp.json). The server exposes 11 focused tools for status, profiles, key assignments, display application, lighting, and explicitly authorized button triggers. Apply and trigger calls are bound to the profile and revision that the caller inspected; triggers also verify the exact action immediately before launch.

The companion skill is at [`skills/vsd-m18-control/SKILL.md`](./skills/vsd-m18-control/SKILL.md). It requires a status read before mutation, uses optimistic revisions to prevent lost updates, separates configuration from hardware application, and will not infer permission to execute commands or delete profiles.

Run the MCP server directly when integrating it with another client:

```bash
npm run mcp
```

Its stdout is reserved for MCP messages. Diagnostics go to stderr.

## Data and recovery

- Configuration: `${XDG_CONFIG_HOME:-~/.config}/vsd-m18-controller/config.json`
- Last-known-good backup: `config.json.bak`
- Uploaded artwork: `${XDG_DATA_HOME:-~/.local/share}/vsd-m18-controller/assets/`
- Local controller: `http://127.0.0.1:31918`

Configuration changes use revision checks. Each save writes and syncs a private temporary file before an atomic rename. If the primary configuration becomes unreadable, startup restores the backup and reports the recovery in the UI and MCP status.

The HTTP service binds to loopback by default, validates Host and Origin headers, applies a restrictive content-security policy, limits uploads and request bodies, and requires a local-client marker for mutations.

## Hardware-safety design

- Only supported VID/PID pairs and the vendor HID usage interface are opened; the M18 boot-keyboard interface is excluded.
- Output reports are fixed-size and short writes fail the connection.
- Complete JPEG transfers are placed on one write queue, so heartbeats and other commands cannot interleave with image data.
- Physical presses execute the last fully applied profile snapshot. Newly saved actions cannot silently outrun old key artwork, and presses are blocked during or before a complete apply.
- Native 64x64 JPEGs are size-bounded and include a JFIF marker for firmware compatibility.
- Key-image commit behavior is selected per known product revision.
- Linux hotplug uses udev events, with a slow reconciliation scan only as a fallback.
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
| `VSD_M18_PORT` | integer | Override port `31918`. |
| `VSD_M18_NO_BROWSER` | `1` | Do not launch a browser at startup. |

This is a controller and setup utility, not a firmware flasher. Real-device writes should begin only after the least-privilege udev rule is installed and the unit has been reconnected.
