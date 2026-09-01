#!/usr/bin/env node
import { Controller } from "./controller.js";
import { APP_VERSION, DEFAULT_HOST, DEFAULT_PORT } from "./constants.js";
import { ControllerHttpServer } from "./http-server.js";
import {
  InstanceSession,
  instanceBaseUrl,
  instanceUiUrl,
  readInstanceDescriptor,
} from "./instance-session.js";
import { openExternal } from "./platform.js";
import { errorMessage, parseInteger, sleep } from "./util.js";

function hasFlag(flag) {
  return process.argv.includes(flag);
}

async function openBrowser(url) {
  if (hasFlag("--headless") || process.env.VSD_M18_NO_BROWSER === "1") return;
  await openExternal(url).catch(() => undefined);
}

async function existingService(descriptor) {
  try {
    const response = await fetch(`${instanceBaseUrl(descriptor)}/api/health`, {
      headers: { "X-VSD-Instance-Token": descriptor.token },
      signal: AbortSignal.timeout(750),
    });
    if (!response.ok) return false;
    const health = await response.json();
    return health.ok === true && health.version === APP_VERSION && health.pid === descriptor.pid;
  } catch {
    return false;
  }
}

async function main() {
  if (hasFlag("--mock")) process.env.VSD_M18_MODE = "mock";
  const host = process.env.VSD_M18_HOST || DEFAULT_HOST;
  const port = parseInteger(process.env.VSD_M18_PORT, DEFAULT_PORT);
  if (!new Set(["127.0.0.1", "localhost", "::1"]).has(host)) {
    throw new Error("VSD_M18_HOST must remain a loopback host (127.0.0.1, localhost, or ::1)");
  }
  let existing = await readInstanceDescriptor();
  const matchesRequestedAddress = (descriptor) =>
    descriptor?.host === host && (port === 0 || descriptor.port === port);
  if (matchesRequestedAddress(existing) && await existingService(existing)) {
    console.error(`M18 Foundry is already running at ${instanceBaseUrl(existing)}`);
    await openBrowser(instanceUiUrl(existing));
    return;
  }

  const session = new InstanceSession();
  if (!(await session.acquire())) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await sleep(100);
      existing = await readInstanceDescriptor();
      if (matchesRequestedAddress(existing) && await existingService(existing)) {
        console.error(`M18 Foundry is already running at ${instanceBaseUrl(existing)}`);
        await openBrowser(instanceUiUrl(existing));
        return;
      }
    }
    throw new Error("Another M18 Foundry process is starting for this user");
  }
  const controller = new Controller();
  const server = new ControllerHttpServer(controller, {
    host,
    port,
    instanceToken: session.token,
  });
  let stopping = false;
  const stop = async (signal) => {
    if (stopping) return;
    stopping = true;
    console.error(`Stopping M18 Foundry (${signal})…`);
    await server.close().catch(() => undefined);
    await controller.stop().catch(() => undefined);
    await session.clear().catch(() => undefined);
  };
  process.once("SIGINT", () => stop("SIGINT").finally(() => process.exit(0)));
  process.once("SIGTERM", () => stop("SIGTERM").finally(() => process.exit(0)));
  process.on("message", (message) => {
    if (message?.type !== "vsd-m18:shutdown") return;
    stop("parent request").finally(() => process.exit(0));
  });

  try {
    await controller.initialize();
    await server.listen();
    const descriptor = await session.publish({ host, port: server.port });
    console.error(
      `M18 Foundry ${process.env.VSD_M18_MODE === "mock" ? "simulator " : ""}is ready at ${instanceBaseUrl(descriptor)}`,
    );
    await openBrowser(instanceUiUrl(descriptor));
    if (hasFlag("--exit-after-ready")) {
      await sleep(50);
      await stop("verification");
    }
  } catch (error) {
    await stop("startup failure");
    throw error;
  }
}

main().catch((error) => {
  console.error(`M18 Foundry could not start: ${errorMessage(error)}`);
  process.exitCode = 1;
});
