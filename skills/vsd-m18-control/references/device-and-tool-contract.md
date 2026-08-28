# Device and tool contract

## Physical layout

- Keys 1-15 are 64×64 LCD keys arranged in five columns by three rows.
- Keys 16-18 are the left, middle, and right non-LCD buttons.
- Supported IDs: VSDinside `5548:1000`, Mirabox `6603:1009`, and Mirabox EN `6603:1012`.
- RGB-capable firmware exposes 24 LEDs. No M18 variant has a knob or touch strip.

## State and recovery

`dock_status.device.state` is one of:

- `connected`: hardware or simulator is ready;
- `disconnected`: no supported unit was found;
- `permission`: the dock was detected but its vendor HID interface could not be opened; on Linux this usually means hidraw access is missing, while on Windows another dock application may hold the interface;
- `starting` or `error`: initialization is incomplete or failed.

Configuration writes use the `revision` returned by the latest read. A conflict means another UI or agent saved first; refresh before deciding whether a retry is still correct. Saves are atomic and retain a last-known-good backup.

`dock_status.appliedState` reports the profile revision successfully written to the connected dock and whether it still matches the current active layout. Physical presses execute the last successfully applied action snapshot, not newer unapplied edits. Physical action execution is blocked until one complete profile apply succeeds after each connection, and while an apply is in progress.

## Mutation boundaries

- `update_key`, `create_profile`, `set_active_profile`, `set_brightness`, and `set_led_color` persist configuration.
- `apply_profile` writes LCD art and lighting to hardware. It requires the inspected active profile ID and revision, and stops if either changed.
- `trigger_button` may launch a process or URL. Inspect the key first, pass its exact action plus profile ID and revision, and require explicit user authorization. A changed snapshot stops execution.
- `delete_profile` is destructive to stored configuration and requires explicit user authorization.
- No tool flashes firmware, sends arbitrary HID packets, opens the boot-keyboard interface, or accepts shell command strings.

The hardware writer serializes complete image transfers so keepalives and other commands cannot corrupt a JPEG packet stream. A transport error discards the handle; reconnection uses a fresh handle and replays desired state only when auto-apply is enabled or the user applies it.

Profile activation and optional hardware application are two stages. If activation saves but application fails, the result reports both facts. Re-read status and do not continue into action execution after a partial failure.
