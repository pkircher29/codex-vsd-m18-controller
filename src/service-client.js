import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { APP_VERSION, DEFAULT_HOST, DEFAULT_PORT } from "./constants.js";
import { instanceBaseUrl, readInstanceDescriptor } from "./instance-session.js";
import { errorMessage, parseInteger, sleep } from "./util.js";

const SERVER_ENTRY = fileURLToPath(new URL("./server.js", import.meta.url));

export class ServiceClient {
  constructor({
    host = process.env.VSD_M18_HOST || DEFAULT_HOST,
    port = parseInteger(process.env.VSD_M18_PORT, DEFAULT_PORT),
    autoStart = true,
  } = {}) {
    this.host = host;
    this.port = port;
    this.baseUrl = `http://${host}:${port}`;
    this.autoStart = autoStart;
    this.ready = null;
    this.instanceDescriptor = null;
  }

  async ensureReady() {
    if (!this.ready) {
      this.ready = this.#ensureReady().catch((error) => {
        this.ready = null;
        throw error;
      });
    }
    return this.ready;
  }

  async getState() {
    return this.request("/api/state");
  }

  async request(path, { method = "GET", body, headers = {} } = {}) {
    await this.ensureReady();
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "X-VSD-Local-Client": "mcp",
        "X-VSD-Instance-Token": this.instanceDescriptor.token,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json()
      : { error: await response.text() };
    if (!response.ok) {
      const error = new Error(payload.error || `Controller returned HTTP ${response.status}`);
      error.statusCode = response.status;
      error.details = payload;
      throw error;
    }
    return payload;
  }

  async replaceConfig(config, expectedRevision) {
    return this.request("/api/config", {
      method: "PUT",
      body: { config, expectedRevision },
    });
  }

  async #ensureReady() {
    if (await this.#adoptHealthyInstance()) return;
    if (!this.autoStart) throw new Error(`M18 Foundry is not running at ${this.baseUrl}`);
    const child = spawn(process.execPath, [SERVER_ENTRY, "--headless"], {
      detached: true,
      env: { ...process.env, VSD_M18_NO_BROWSER: "1" },
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", () => undefined);
    child.unref();
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await sleep(150);
      if (await this.#adoptHealthyInstance()) return;
    }
    throw new Error(`M18 Foundry did not become ready at ${this.baseUrl}`);
  }

  async #adoptHealthyInstance() {
    const descriptor = await readInstanceDescriptor();
    if (
      !descriptor ||
      descriptor.host !== this.host ||
      (this.port !== 0 && descriptor.port !== this.port)
    ) return false;
    const baseUrl = instanceBaseUrl(descriptor);
    try {
      const response = await fetch(`${baseUrl}/api/health`, {
        headers: { "X-VSD-Instance-Token": descriptor.token },
        signal: AbortSignal.timeout(500),
      });
      if (!response.ok) return false;
      const health = await response.json();
      if (
        health.ok !== true ||
        health.version !== APP_VERSION ||
        health.pid !== descriptor.pid
      ) return false;
      this.baseUrl = baseUrl;
      this.instanceDescriptor = descriptor;
      return true;
    } catch (error) {
      if (/abort|timeout|fetch failed/i.test(errorMessage(error))) return false;
      return false;
    }
  }
}
