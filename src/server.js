#!/usr/bin/env node
import { spawn } from "node:child_process";
import { Controller } from "./controller.js";
import { DEFAULT_HOST, DEFAULT_PORT } from "./constants.js";
import { ControllerHttpServer } from "./http-server.js";
import { errorMessage, parseInteger, sleep } from "./util.js";

function hasFlag(flag) {
  return process.argv.includes(flag);
}

async function openBrowser(url) {
  if (hasFlag("--headless") || process.env.VSD_M18_NO_BROWSER === "1") return;
  const child = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
  child.once("error", () => undefined);
  child.unref();
}

async function existingService(url) {
  try {
    const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(750) });
    return response.ok;
  } catch {
    return false;
  }
}

async function main() {
  const host = process.env.VSD_M18_HOST || DEFAULT_HOST;
  const port = parseInteger(process.env.VSD_M18_PORT, DEFAULT_PORT);
  const url = `http://${host}:${port}`;
  if (await existingService(url)) {
    console.error(`M18 Foundry is already running at ${url}`);
    await openBrowser(url);
    return;
  }

  const controller = new Controller();
  const server = new ControllerHttpServer(controller, { host, port });
  let stopping = false;
  const stop = async (signal) => {
    if (stopping) return;
    stopping = true;
    console.error(`Stopping M18 Foundry (${signal})…`);
    await server.close().catch(() => undefined);
    await controller.stop().catch(() => undefined);
  };
  process.once("SIGINT", () => stop("SIGINT").finally(() => process.exit(0)));
  process.once("SIGTERM", () => stop("SIGTERM").finally(() => process.exit(0)));

  await controller.initialize();
  await server.listen();
  console.error(`M18 Foundry ${process.env.VSD_M18_MODE === "mock" ? "simulator " : ""}is ready at ${url}`);
  await openBrowser(url);
  if (hasFlag("--exit-after-ready")) {
    await sleep(50);
    await stop("verification");
  }
}

main().catch((error) => {
  console.error(`M18 Foundry could not start: ${errorMessage(error)}`);
  process.exitCode = 1;
});
