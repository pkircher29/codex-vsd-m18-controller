import assert from "node:assert/strict";
import test from "node:test";
import { resolveShortcut, tokenizeCommand } from "../src/shortcut-resolver.js";

test("command paste preserves quoted arguments without using a shell", () => {
  assert.deepEqual(tokenizeCommand('/usr/bin/example --title "Morning show" \'literal value\''), [
    "/usr/bin/example",
    "--title",
    "Morning show",
    "literal value",
  ]);
});

test("Linux desktop shortcuts become direct executable and argument actions", async () => {
  const shortcut = await resolveShortcut({
    name: "Music.desktop",
    content: [
      "[Desktop Entry]",
      "Type=Application",
      "Name=Music Control",
      'Exec=/usr/bin/playerctl --player=spotify "play-pause" %U',
    ].join("\n"),
  });
  assert.deepEqual(shortcut, {
    label: "Music Control",
    action: {
      type: "command",
      executable: "/usr/bin/playerctl",
      args: ["--player=spotify", "play-pause"],
    },
  });
});

test("internet shortcuts and pasted addresses become URL actions", async () => {
  const fileShortcut = await resolveShortcut({
    name: "Dashboard.url",
    content: "[InternetShortcut]\nURL=https://example.com/control?view=live",
  });
  assert.equal(fileShortcut.label, "Dashboard");
  assert.deepEqual(fileShortcut.action, {
    type: "url",
    url: "https://example.com/control?view=live",
  });

  const pasted = await resolveShortcut({
    name: "Pasted command",
    content: "https://example.com/",
  });
  assert.equal(pasted.action.type, "url");
});
