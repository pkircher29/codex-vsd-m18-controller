# M18 Foundry Help

M18 Foundry configures VSDinside and Mirabox M18 Stream Docks from a local browser workspace. It can edit and store ordered control pages, render each page's 15 LCD keys, control brightness and chassis LEDs, and bind safe direct actions to the LCD controls.

## First run

Install the Windows setup executable or Linux Debian package from the GitHub release, then open **M18 Foundry** from the application menu. The packaged application includes its runtime. The Linux AppImage can be run directly after making it executable, but its user must install the included device-specific udev rule before controlling physical hardware.

For a source checkout, run one of these commands:

```bash
npm start
```

```powershell
node .\src\server.js
```

The first-run guide has three steps:

1. Review the local-only editing and action-safety model.
2. Connect the M18 and check whether its vendor HID interface is available.
3. Name the first control page and choose whether to apply it now or automatically after future reconnects.

Choose **Skip for now** to enter the workspace without completing setup. The guide returns on the next browser launch. After setup is complete, choose **Setup guide** in the footer to run it again.

## Understand the workspace

- **Control pages** are ordered saved layouts. Only one page is active at a time.
- **M18 faceplate** previews the active page's 15 LCD controls and the three reserved page buttons.
- **Inspector** edits the selected key's label, color, artwork, and action.
- **Save** writes the configuration to disk without changing the dock.
- **Apply to M18** saves the current draft, renders all 15 LCD keys, then writes brightness, LED color, and artwork to the connected device.
- **Update hardware** changes brightness and LED color without rewriting the key images.

LCD actions use the last page that completed a full hardware apply. A saved-but-unapplied draft cannot silently run behind older artwork.

## Navigate control pages

- Press **Back** (bottom-left) to show the previous page. From page 1, it wraps to the last page.
- Press **Home** (bottom-center) to return directly to page 1.
- Press **Next** (bottom-right) to show the next page. From the last page, it wraps to page 1.

Selecting one of these buttons on the browser faceplate previews the destination as a draft. Pressing the physical button changes the saved active page and immediately applies its 15 LCD faces. The bottom buttons are reserved; older command bindings on keys 16-18 are ignored and replaced by navigation.

## Assign a key

Select an LCD key on the faceplate, then use one of these methods:

- enter a label and choose a face color;
- upload PNG, JPEG, WebP, or GIF artwork;
- choose or drop a Linux `.desktop` shortcut, Windows shortcut target, URL shortcut, executable, web address, or image;
- paste a command and review the parsed executable and argument list; or
- choose **Design with AI** to generate a draft layout for review.

Create or duplicate pages from the **Control pages** rail. Page order in that rail is the order used by Back and Next. An LCD key can also use **Go to page** for a direct jump.

## Device status and display troubleshooting

### Device is not found

1. Connect the M18 directly to the computer rather than through an unpowered hub.
2. Close other Stream Dock, OpenDeck, Companion, or vendor software that may own the HID interface.
3. Open **Setup guide**, go to **Device**, and choose **Check again**.
4. Unplug and reconnect the dock if the status does not change.

Supported USB identities are `5548:1000`, `6603:1009`, and `6603:1012`. Other Stream Dock models are not accepted.

### Linux reports blocked access

Run the included installer, then reconnect the dock:

```bash
./scripts/install-linux.sh
```

The installer adds a device-specific udev rule with desktop-seat access. It does not make every HID device world-writable.

### The dock connects but LCD keys stay blank

1. Confirm that M18 Foundry reports **Connected**, not **Simulator**.
2. Choose **Apply to M18** and wait for all 15 keys to complete.
3. Verify brightness is above zero.
4. Restart the user service and apply again:

   ```bash
   systemctl --user restart vsd-m18-controller.service
   ```

5. Close any second process using the dock and reconnect it.

M18 Foundry release builds emit baseline 64x64 JFIF JPEGs. Progressive JPEG output can be accepted by USB while still being rejected by the dock's embedded display decoder.

### Windows cannot open the dock

Close other dock software, reconnect the unit, and relaunch M18 Foundry. The Windows installer does not require an additional driver or Administrator access.

## Actions and confirmation

- Commands are spawned directly with an exact argument array; no shell parses them.
- URLs must use HTTP or HTTPS.
- Go-to-page actions on LCD keys can select and apply another saved page.
- Testing a command or URL from the browser requires confirmation.
- Setup and page application never execute assigned actions.

## AI-assisted layouts

AI output is always an untrusted draft for the 15 LCD controls; it cannot redefine Back, Home, or Next. Review every label, executable, argument, URL, and page link before saving or applying it. API keys are used for the current request only. OAuth access tokens remain in the running controller process and are represented in the browser by an opaque local connection ID.

Cloud chat subscriptions do not automatically include API access or billing.

## Configuration and recovery

| Data | Linux | Windows |
|---|---|---|
| Configuration | `${XDG_CONFIG_HOME:-~/.config}/vsd-m18-controller/config.json` | `%APPDATA%\M18Foundry\config.json` |
| Backup | `config.json.bak` beside the configuration | `config.json.bak` beside the configuration |
| Artwork | `${XDG_DATA_HOME:-~/.local/share}/vsd-m18-controller/assets/` | `%LOCALAPPDATA%\M18Foundry\assets\` |

Each save is atomic and revision-checked. If the primary configuration is unreadable, startup restores the last-known-good backup and reports the recovery in the workspace.

## Diagnostics

Run the complete project verification:

```bash
npm run verify
```

Check the Linux user service:

```bash
systemctl --user status vsd-m18-controller.service
journalctl --user -u vsd-m18-controller.service --no-pager -n 100
```

Start the simulator without touching USB hardware:

```bash
npm run demo
```

When reporting a device problem, include the operating system, USB VID/PID, device serial if available, M18 Foundry version, controller status message, and whether another dock application is running.
