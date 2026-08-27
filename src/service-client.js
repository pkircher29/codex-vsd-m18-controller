import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DEFAULT_HOST, DEFAULT_PORT } from "./constants.js";
import { errorMessage, parseInteger, sleep } from "./util.js";

const SERVER_ENTRY = fileURLToPath(new URL("./server.js", import.meta.url));

export class ServiceClient {
  constructor({
    host = process.env.VSD_M18_HOST || DEFAULT_HOST,
    port = parseInteger(process.env.VSD_M18_PORT, DEFAULT_PORT),
    autoStart = true,
  } = {}) {
    this.baseUrl = `http://${host}:${port}`;
    this.autoStart = autoStart;
    this.ready = null;
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
    if (await this.#isHealthy()) return;
    if (!this.autoStart) throw new Error(`M18 Foundry is not running at ${this.baseUrl}`);
    const child = spawn(process.execPath, [SERVER_ENTRY, "--headless"], {
      detached: true,
      env: { ...process.env, VSD_M18_NO_BROWSER: "1" },
      stdio: "ignore",
    });
    child.once("error", () => undefined);
    child.unref();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await sleep(150);
      if (await this.#isHealthy()) return;
    }
    throw new Error(`M18 Foundry did not become ready at ${this.baseUrl}`);
  }

  async #isHealthy() {
    try {
      const response = await fetch(`${this.baseUrl}/api/health`, {
        signal: AbortSignal.timeout(500),
      });
      return response.ok;
    } catch (error) {
      if (/abort|timeout|fetch failed/i.test(errorMessage(error))) return false;
      return false;
    }
  }
}
