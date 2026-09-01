# M18 Foundry Product and Technical Specification

Version: 0.2.0
Status: release specification

## 1. Purpose

M18 Foundry is a cross-platform local controller for the 18-button VSDinside and Mirabox M18 Stream Dock family. It provides a browser-based layout workspace, persistent profiles, deterministic LCD rendering, controlled HID output, button-action execution, a simulator, and an MCP interface.

The primary user is an operator configuring one locally attached M18 on Linux or Windows. The primary task is to make a legible, trustworthy button layout and apply it to the dock without accidentally executing assigned actions.

## 2. Supported hardware

| Model | VID:PID | Vendor HID interface | LCD keys | Chassis buttons |
|---|---|---|---:|---:|
| VSDinside M18 | `5548:1000` | usage page `0xFFA0`, usage `0x01` | 15 | 3 |
| Mirabox M18 | `6603:1009` | usage page `0xFFA0`, usage `0x01` | 15 | 3 |
| Mirabox M18 EN | `6603:1012` | usage page `0xFFA0`, usage `0x01` | 15 | 3 |

The boot-keyboard interface is excluded. Unsupported USB identities and arbitrary HID reports are outside scope. Firmware flashing is not supported.

## 3. Product requirements

### 3.1 Profiles and editing

- Store between 1 and 50 profiles.
- Store exactly 18 ordered keys per profile.
- Allow labels, colors, and optional image assets on LCD keys 1-15.
- Reject image assets on chassis buttons 16-18.
- Support no-op, direct command, HTTP(S) URL, and profile-switch actions.
- Preserve exact executable and argument boundaries without invoking a shell.
- Keep browser edits as a draft until the user saves or applies them.
- Use revision checks to prevent one client from silently overwriting another.

### 3.2 Hardware application

- Render all LCD keys before beginning a profile write.
- Serialize the entire HID write sequence, including image chunks and heartbeat traffic.
- Wake the display, set brightness and LED color, clear stale artwork, transfer 15 images, and commit the display.
- Treat a short HID write as a connection failure.
- Bind executable physical-button state to the last completely applied profile snapshot.
- Invalidate the applied snapshot during a failed, partial, or interrupted apply.

### 3.3 First-run guide

Fresh configurations set `setup.completed` to `false`. Existing schema-v1 configurations that predate the field infer completion when their revision is greater than zero.

The guide has three steps:

1. **Start** explains local-only operation, draft behavior, and action safety.
2. **Device** reports connected, simulated, disconnected, permission, and error states and offers an explicit rescan.
3. **Profile** names the active starter profile, selects reconnect auto-apply, and optionally applies the layout immediately.

Completion must be persisted through the normal revision-checked configuration write. Applying during setup must use the saved profile ID and revision. Skipping must not mark setup complete. The guide must remain available from the workspace footer after completion.

### 3.4 Complete state model

The UI must expose initial loading, connected, simulated, disconnected, permission denied, device error, busy, success, validation error, stale revision, and controller-offline states. Mutations must be disabled while another mutation is active. Meaningful async outcomes must be announced through status or alert regions.

## 4. Configuration contract

Schema version remains `1` for the backward-compatible v0.2.0 addition.

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

## 5. HTTP and session contract

- Bind to an operating-system-assigned loopback port by default.
- Publish a private per-user instance descriptor containing the host, port, process ID, version, and capability token.
- Require the capability token for every API route.
- Require `X-VSD-Local-Client` on mutations.
- Validate Host and Origin headers and apply a restrictive content-security policy.
- `POST /api/device/scan` performs a supported-device rescan and returns current controller state.
- `POST /api/device/apply` requires the inspected active profile ID and configuration revision.
- Action triggers require the inspected profile, revision, and exact action; external command and URL tests require explicit confirmation.

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
- Setup, save, apply, brightness, and LED operations never execute key actions.
- No API accepts arbitrary HID packets or flashes firmware.

## 8. Accessibility and responsive behavior

The browser workspace targets WCAG 2.2 Level AA. The setup dialog uses native dialog, form, heading, list, fieldset, input, and button semantics; maintains logical focus; restores focus after closing; exposes validation errors; announces device status; supports keyboard-only operation; and reflows from desktop to a 320 CSS-pixel viewport. Focus indicators, status meaning, and selection must not rely on color alone. Reduced-motion and forced-colors modes must remain usable.

## 9. Release acceptance criteria

A tagged v0.2.0 build is acceptable when:

- syntax checks pass;
- all automated tests pass;
- a fresh simulator configuration opens the first-run guide;
- skipping does not persist completion;
- finishing persists the profile name, setup completion, and auto-apply choice;
- applying from setup writes 15 simulated LCD images without triggering an action;
- an existing revised schema-v1 configuration does not reopen the guide automatically;
- the UI is inspected at narrow mobile, tablet, and desktop widths;
- generated key JPEGs are 64x64, JFIF, baseline, and within the payload limit;
- a supported physical M18 can be opened and accepts a complete profile application; and
- the release commit is tagged `v0.2.0` only after verification.

## 10. Non-goals

- Firmware updates or recovery flashing.
- Remote network control.
- Shell command parsing or arbitrary script evaluation.
- Automatic execution of AI-generated actions.
- Support for non-M18 Stream Dock models.
