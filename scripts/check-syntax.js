#!/usr/bin/env node
import { readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { spawnSync } from "node:child_process";

const roots = ["src", "public", "scripts", "test"];

async function javascriptFiles(path) {
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...(await javascriptFiles(child)));
    else if (extname(entry.name) === ".js") files.push(child);
  }
  return files;
}

let failed = false;
for (const root of roots) {
  for (const file of await javascriptFiles(root)) {
    const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
    if (result.status !== 0) failed = true;
  }
}
if (failed) process.exitCode = 1;
else console.log("JavaScript syntax check passed");
