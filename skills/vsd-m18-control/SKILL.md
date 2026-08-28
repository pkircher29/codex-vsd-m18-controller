---
name: vsd-m18-control
description: Inspect, configure, render, and safely trigger VSDinside or Mirabox M18 Stream Dock profiles through the local vsdM18 MCP server. Use when the user asks about their M18 device, buttons, LCD artwork, profiles, brightness, LEDs, Linux or Windows access, or configured actions. Do not use for firmware flashing or unrelated Stream Deck models.
---

# VSD M18 Control

Use the `vsdM18` MCP tools as the control plane. Start with `dock_status`; report a disconnected, permission, or recovery state before proposing mutations.

Also inspect `appliedState` before describing physical behavior. A null value means no complete layout has been verified since connection; `inSync=false` means saved edits differ from the dock. Physical presses use the last fully applied action snapshot and are blocked until the first successful apply.

For configuration work:

1. Read `get_profile` or `list_profiles` and retain the returned revision.
2. Make one scoped mutation using that revision. `update_key` changes stored configuration only.
3. Call `apply_profile` only when the user wants the active layout written to the physical LCD keys. Pass the exact inspected profile ID and latest revision. Applying replaces existing device artwork but does not delete stored profiles.
4. If a revision conflict occurs, read the latest state and retry at most once when the requested edit still applies cleanly.

Change only fields the user requested; preserve existing labels, colors, artwork, and actions unless the task requires changing them.

Never infer permission to run a configured command or open a URL. Immediately before `trigger_button`, read the target profile and copy its profile ID, revision, and exact action. Base any confirmation on that exact action, then reuse the unchanged snapshot in the trigger request; never re-read and substitute a different action after approval. Use `confirm=true` only after the user explicitly asks to execute that button. If any snapshot precondition fails, stop and re-inspect instead of substituting the new action. Treat profile deletion similarly: explain the target, then pass confirmation only for an explicit deletion request.

`set_active_profile` saves activation first and applies hardware second when `apply=true`. If its result reports an application error, re-read state, do not trigger a button, and explain that stored activation succeeded while the physical display did not update.

LCD artwork applies to keys 1-15. Keys 16-18 are physical non-LCD buttons. Do not attach an image asset to those three buttons. Preserve exact executable/argument boundaries for command actions; the controller intentionally does not invoke a shell.

For a Linux `permission` state, direct the user to the repository's `scripts/install-linux.sh` and tell them the dock must be reconnected once. Do not weaken udev permissions or substitute a world-writable rule. On Windows, the controller uses the native HID interface without a bundled driver; ask the user to close other dock software and reconnect the M18. Do not recommend changing device drivers unless diagnosis identifies a separate driver problem.

For protocol, layout, and recovery details needed during diagnosis, read [Device and tool contract](references/device-and-tool-contract.md).
