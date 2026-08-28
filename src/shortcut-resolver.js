import { access, readFile, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { basename, extname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_SHORTCUT_TEXT = 256 * 1024;

function shortcutError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function labelFromName(name) {
  const clean = String(name || "Shortcut").replace(/\.(desktop|url|webloc|lnk)$/i, "").trim();
  return (clean || "Shortcut").slice(0, 32);
}

function unescapeDesktopValue(value) {
  return value
    .replace(/\\s/g, " ")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\r/g, "\r")
    .replace(/\\\\/g, "\\");
}

export function tokenizeCommand(value) {
  if (typeof value !== "string" || value.trim().length === 0 || value.includes("\0")) {
    throw shortcutError("Paste a command with an executable name or path");
  }
  const tokens = [];
  let token = "";
  let quote = null;
  let escaped = false;
  let started = false;
  for (const character of value.trim()) {
    if (escaped) {
      token += character;
      escaped = false;
      started = true;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      started = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      else token += character;
      started = true;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      started = true;
      continue;
    }
    if (/\s/.test(character)) {
      if (started) {
        tokens.push(token);
        token = "";
        started = false;
      }
      continue;
    }
    token += character;
    started = true;
  }
  if (escaped) token += "\\";
  if (quote) throw shortcutError("The pasted command has an unclosed quote");
  if (started) tokens.push(token);
  if (!tokens.length || !tokens[0]) throw shortcutError("The command executable is missing");
  return tokens;
}

function commandAction(value, { desktop = false } = {}) {
  let tokens = tokenizeCommand(value);
  if (desktop) {
    tokens = tokens
      .map((token) => token.replace(/%%/g, "%").replace(/%[fFuUdDnNickvm]/g, ""))
      .filter(Boolean);
  }
  if (!tokens.length) throw shortcutError("The shortcut command is empty");
  return { type: "command", executable: tokens[0], args: tokens.slice(1) };
}

function urlAction(value) {
  let parsed;
  try {
    parsed = new URL(String(value || "").trim());
  } catch {
    parsed = null;
  }
  if (!parsed || !new Set(["http:", "https:"]).has(parsed.protocol)) {
    throw shortcutError("The shortcut does not contain a valid HTTP or HTTPS address");
  }
  return { type: "url", url: parsed.toString() };
}

function desktopFields(content) {
  const fields = new Map();
  let inDesktopEntry = false;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[") && line.endsWith("]")) {
      inDesktopEntry = line.toLowerCase() === "[desktop entry]";
      continue;
    }
    if (!inDesktopEntry) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    if (!key.includes("[")) fields.set(key, unescapeDesktopValue(line.slice(separator + 1).trim()));
  }
  return fields;
}

function parseShortcutText({ name, content }) {
  if (typeof content !== "string" || content.length > MAX_SHORTCUT_TEXT || content.includes("\0")) {
    throw shortcutError("Shortcut content is missing or too large");
  }
  const extension = extname(name || "").toLowerCase();
  const fallbackLabel = labelFromName(name);
  if (extension === ".desktop" || /^\s*\[Desktop Entry\]/im.test(content)) {
    const fields = desktopFields(content);
    const label = (fields.get("Name") || fallbackLabel).slice(0, 32);
    if ((fields.get("Type") || "").toLowerCase() === "link" || fields.has("URL")) {
      return { label, action: urlAction(fields.get("URL")) };
    }
    if (!fields.get("Exec")) throw shortcutError("The desktop shortcut has no Exec command");
    return { label, action: commandAction(fields.get("Exec"), { desktop: true }) };
  }
  if (extension === ".url" || /^\s*\[InternetShortcut\]/im.test(content)) {
    const match = content.match(/^\s*URL\s*=\s*(.+)$/im);
    if (!match) throw shortcutError("The internet shortcut has no URL");
    return { label: fallbackLabel, action: urlAction(match[1]) };
  }
  if (extension === ".webloc") {
    const match = content.match(/<key>URL<\/key>\s*<string>([^<]+)<\/string>/i);
    if (!match) throw shortcutError("The web location has no URL");
    return { label: fallbackLabel, action: urlAction(match[1]) };
  }
  const trimmed = content.trim();
  if (/^https?:\/\//i.test(trimmed)) return { label: fallbackLabel, action: urlAction(trimmed) };
  return { label: fallbackLabel, action: commandAction(trimmed) };
}

function sourcePath(value) {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) return null;
  const clean = value.trim();
  if (clean.startsWith("file:")) {
    try {
      return fileURLToPath(clean);
    } catch {
      throw shortcutError("The dropped file address is invalid");
    }
  }
  return isAbsolute(clean) ? clean : null;
}

export async function resolveShortcut(input = {}) {
  const suppliedContent = typeof input.content === "string" ? input.content : null;
  const path = sourcePath(input.source);
  let name = typeof input.name === "string" ? input.name.slice(0, 255) : "Shortcut";
  let content = suppliedContent;
  if (path) {
    name = basename(path);
    const extension = extname(path).toLowerCase();
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) throw shortcutError("The dropped shortcut file could not be read");
    if (!new Set([".desktop", ".url", ".webloc", ".txt", ".command", ".sh"]).has(extension)) {
      if (process.platform !== "win32") {
        await access(path, fsConstants.X_OK).catch(() => {
          throw shortcutError("Drop a .desktop, .url, executable, script, or web address");
        });
      }
      return { label: labelFromName(name), action: { type: "command", executable: path, args: [] } };
    }
    content = await readFile(path, { encoding: "utf8", signal: AbortSignal.timeout(3000) });
  }
  if (extname(name).toLowerCase() === ".lnk") {
    throw shortcutError("Windows .lnk files must be dropped from their original path; exported .url shortcuts are supported everywhere");
  }
  return parseShortcutText({ name, content: content || String(input.source || "") });
}

export { MAX_SHORTCUT_TEXT };
