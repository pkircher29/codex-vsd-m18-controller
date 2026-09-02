# M18 Foundry Product and Technical Specification

Version: 0.2.1
Status: release specification

## 1. Purpose

M18 Foundry is a cross-platform local controller for the 18-button VSDinside and Mirabox M18 Stream Dock family. It provides a browser-based layout workspace, ordered 15-control pages, deterministic LCD rendering, reserved physical page navigation, controlled HID output, button-action execution, a simulator, and an MCP interface.

The primary user is an operator configuring one locally attached M18 on Linux or Windows. The primary task is to make a legible, trustworthy button layout and apply it to the dock without accidentally executing assigned actions.

## 2. Supported hardware

| Model | VID:PID | Vendor HID interface | LCD keys | Chassis buttons |
|---|---|---|---:|---:|
| VSDinside M18 | `5548:1000` | usage page `0xFFA0`, usage `0x01` | 15 | 3 |
| Mirabox M18 | `6603:1009` | usage page `0xFFA0`, usage `0x01` | 15 | 3 |
| Mirabox M18 EN | `6603:1012` | usage page `0xFFA0`, usage `0x01` | 15 | 3 |

The boot-keyboard interface is excluded. Unsupported USB identities and arbitrary HID reports are outside scope. Firmware flashing is not supported.

## 3. Product requirements

### 3.1 Control pages and editing

- Store between 1 and 50 ordered control pages. The configuration and API retain the `profiles` name for compatibility.
- Store exactly 18 ordered key records per page: 15 configurable LCD controls and three reserved navigation inputs.
- Allow labels, colors, and optional image assets on LCD keys 1-15.
- Reject image assets and user-defined actions on chassis buttons 16-18.
- Reserve key 16 for the previous page, key 17 for page 1, and key 18 for the next page. Previous and next wrap at the ends of the page list.
- Normalize legacy key 16-18 labels and actions to `BACK`, `HOME`, and `NEXT` navigation during validation so old commands cannot execute.
- Support no-op, direct command, HTTP(S) URL, and direct page-jump actions on LCD keys.
- Preserve exact executable and argument boundaries without invoking a shell.
- Keep browser edits as a draft until the user saves or applies them.
- Use revision checks to prevent one client from silently overwriting another.

### 3.2 Hardware application

- Render all LCD keys before beginning a page write.
- Serialize the entire HID write sequence, including image chunks and heartbeat traffic.
- Wake the display, set brightness and LED color, clear stale artwork, transfer 15 images, and commit the display.
- Treat a short HID write as a connection failure.
- Bind executable LCD-button state to the last completely applied page snapshot.
- Invalidate the applied snapshot during a failed, partial, or interrupted apply.
- Allow a reserved navigation button to apply a page after reconnect even when no action snapshot exists yet.
- Persist the selected page before applying it, and report partial activation if the display write fails.

### 3.3 First-run guide

Fresh configurations set `setup.completed` to `false`. Existing schema-v1 configurations that predate the field infer completion when their revision is greater than zero.

The guide has three steps:

1. **Start** explains local-only operation, draft behavior, and action safety.
2. **Device** reports connected, simulated, disconnected, permission, and error states and offers an explicit rescan.
3. **Page** names the first control page, selects reconnect auto-apply, and optionally applies the layout immediately.

Completion must be persisted through the normal revision-checked configuration write. Applying during setup must use the saved page ID and revision. Skipping must not mark setup complete. The guide must remain available from the workspace footer after completion.

### 3.4 Complete state model

The UI must expose initial loading, connected, simulated, disconnected, permission denied, device error, busy, success, validation error, stale revision, and controller-offline states. Mutations must be disabled while another mutation is active. Meaningful async outcomes must be announced through status or alert regions.

## 4. Configuration contract

Schema version remains `1`. Control pages continue to use the established `profiles` field and profile IDs on disk and over the API.

```json
{
  "schemaVersion": 1,
  "revision": 0,
  "activeProfileId": "profile-id",
  "setup": {
    "completed": false
  },
  "device": {
    "brightness": 72,
    "ledColor": "#E59B3A",
    "autoApply": false
  },
  "profiles": []
}
```

Every successful configuration replacement increments `revision`. Writes use a private temporary file, file sync, atomic rename, and a last-known-good backup.

Each page's final three key records are canonicalized as follows:

```json
[
  { "index": 16, "label": "BACK", "action": { "type": "navigation", "target": "previous" } },
  { "index": 17, "label": "HOME", "action": { "type": "navigation", "target": "first" } },
  { "index": 18, "label": "NEXT", "action": { "type": "navigation", "target": "next" } }
]
```

## 5. HTTP and session contract

- Bind to an operating-system-assigned loopback port by default.
- Publish a private per-user instance descriptor containing the host, port, process ID, version, and capability token.
- Require the capability token for every API route.
- Require `X-VSD-Local-Client` on mutations.
- Validate Host and Origin headers and apply a restrictive content-security policy.
- `POST /api/device/scan` performs a supported-device rescan and returns current controller state.
- `POST /api/device/apply` requires the inspected active page ID and configuration revision.
- Action triggers require the inspected page, revision, and exact action; external command and URL tests require explicit confirmation.
- Triggering keys 16-18 performs controller-owned page navigation and never dispatches their legacy stored action to the action runner.

## 6. M18 HID display protocol

The selected output interface uses 1025-byte reports: a zero report ID followed by a 1024-byte payload. Commands begin with `CRT\0\0`.

Key images use this sequence:

1. Send `BAT` with a four-byte big-endian JPEG length and the mapped hardware key.
2. Send the JPEG in 1024-byte zero-padded image reports.
3. Commit with `STP` for device revisions that require an explicit commit.

LCD images are baseline, non-progressive, 64x64 RGB JFIF JPEGs no larger than 10 KiB. This baseline requirement is important: a successful HID write does not prove that the dock's embedded JPEG decoder accepted the image.

Logical LCD rows map to hardware codes as follows:

```text
Logical  1  2  3  4  5  -> Hardware 11 12 13 14 15
Logical  6  7  8  9 10  -> Hardware  6  7  8  9 10
Logical 11 12 13 14 15  -> Hardware  1  2  3  4  5
Logical 16 17 18        -> Hardware 37 48 49
```

The implementation is informed by the [official StreamDock Device SDK](https://github.com/MiraboxSpace/StreamDock-Device-SDK), [Bitfocus's Mirabox surface](https://github.com/bitfocus/companion-surface-mirabox-stream-dock), and [OpenDeck M18](https://github.com/ibanks42/opendeck-m18).

## 7. Security and safety

- The server is local-only and capability-authenticated.
- Upload and request sizes are bounded.
- Asset types are validated and decoded before storage.
- AI output is untrusted draft data and cannot execute during generation.
- OAuth provider tokens remain in controller memory and are not exposed to the browser.
- Setup, save, apply, navigation, brightness, and LED operations never execute LCD-key actions.
- No API accepts arbitrary HID packets or flashes firmware.

## 8. Accessibility and responsive behavior

The browser workspace targets WCAG 2.2 Level AA. The setup dialog uses native dialog, form, heading, list, fieldset, input, and button semantics; maintains logical focus; restores focus after closing; exposes validation errors; announces device status; supports keyboard-only operation; and reflows from desktop to a 320 CSS-pixel viewport. Control pages show their index and active state in text and shape, and the faceplate exposes the same Back, Home, and Next navigation order as the hardware. Focus indicators, status meaning, and selection must not rely on color alone. Reduced-motion and forced-colors modes must remain usable.

## 9. Release acceptance criteria

A tagged v0.2.1 build is acceptable when:

- syntax checks pass;
- all automated tests pass;
- a fresh simulator configuration opens the first-run guide;
- skipping does not persist completion;
- finishing persists the profile name, setup completion, and auto-apply choice;
- applying from setup writes 15 simulated LCD images without triggering an action;
- an existing revised schema-v1 configuration does not reopen the guide automatically;
- the UI is inspected at narrow mobile, tablet, and desktop widths;
- generated key JPEGs are 64x64, JFIF, baseline, and within the payload limit;
- keys 16-18 are normalized to previous, first-page, and next-page navigation;
- Back and Next wrap through at least three ordered pages, while Home reaches page 1 in one press;
- a navigation press after reconnect can apply a page before ordinary LCD actions are enabled;
- no prior bottom-button command reaches the action runner;
- a supported physical M18 can be opened and accepts a complete profile application; and
- the release commit is tagged `v0.2.1` only after verification.

## 10. Non-goals

- Firmware updates or recovery flashing.
- Remote network control.
- Shell command parsing or arbitrary script evaluation.
- Automatic execution of AI-generated actions.
- Support for non-M18 Stream Dock models.
