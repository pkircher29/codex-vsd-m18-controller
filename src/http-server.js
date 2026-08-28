import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, isAbsolute, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_VERSION, DEFAULT_HOST, DEFAULT_PORT, MAX_ASSET_BYTES, MAX_CONFIG_BYTES } from "./constants.js";
import { RevisionConflictError } from "./config-store.js";
import { createInstanceToken, instanceTokensEqual } from "./instance-session.js";
import { errorMessage } from "./util.js";

const PUBLIC_DIRECTORY = resolve(fileURLToPath(new URL("../public/", import.meta.url)));
const STATIC_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".ico", "image/x-icon"],
]);

function securityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  );
}

function sendJson(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", body.length);
  response.end(body);
}

function methodIsMutation(method) {
  return !new Set(["GET", "HEAD", "OPTIONS"]).has(method);
}

function requireOperationSnapshot(body, { includeAction = false } = {}) {
  if (typeof body.profileId !== "string" || body.profileId.length === 0) {
    throw new TypeError("profileId is required for this operation");
  }
  if (!Number.isInteger(body.expectedRevision) || body.expectedRevision < 0) {
    throw new TypeError("expectedRevision must be a non-negative integer");
  }
  if (
    includeAction &&
    (!body.expectedAction || typeof body.expectedAction !== "object" || Array.isArray(body.expectedAction))
  ) {
    throw new TypeError("expectedAction is required for this operation");
  }
  if (body.confirm !== undefined && typeof body.confirm !== "boolean") {
    throw new TypeError("confirm must be true or false");
  }
}

async function readBody(request, limit) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) {
      const error = new Error(`Request exceeds the ${Math.floor(limit / 1024)} KB limit`);
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(request) {
  const body = await readBody(request, MAX_CONFIG_BYTES);
  if (!body.length) return {};
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    const error = new TypeError("Request body is not valid JSON");
    error.statusCode = 400;
    throw error;
  }
}

function safeStaticPath(pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const clean = normalize(decodeURIComponent(requested)).replace(/^[/\\]+/, "");
  const path = resolve(PUBLIC_DIRECTORY, clean);
  const displacement = relative(PUBLIC_DIRECTORY, path);
  return displacement &&
    displacement !== ".." &&
    !displacement.startsWith(`..${sep}`) &&
    !isAbsolute(displacement)
    ? path
    : null;
}

export class ControllerHttpServer {
  #server;
  #clients = new Set();
  #heartbeat = null;

  constructor(
    controller,
    { host = DEFAULT_HOST, port = DEFAULT_PORT, instanceToken = createInstanceToken() } = {},
  ) {
    this.controller = controller;
    this.host = host;
    this.port = port;
    this.instanceToken = instanceToken;
    this.#server = createServer((request, response) => {
      this.#handle(request, response).catch((error) => this.#handleError(error, response));
    });
    controller.on("state", (state) => this.broadcast(state));
  }

  async listen() {
    await new Promise((resolvePromise, reject) => {
      const onError = (error) => {
        this.#server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        this.#server.off("error", onError);
        resolvePromise();
      };
      this.#server.once("error", onError);
      this.#server.once("listening", onListening);
      this.#server.listen(this.port, this.host);
    });
    this.#heartbeat = setInterval(() => {
      for (const response of this.#clients) response.write(": heartbeat\n\n");
    }, 15_000);
    this.#heartbeat.unref?.();
    const address = this.#server.address();
    if (address && typeof address === "object") this.port = address.port;
    return this.url;
  }

  get url() {
    return `http://${this.host}:${this.port}`;
  }

  async close() {
    clearInterval(this.#heartbeat);
    for (const response of this.#clients) response.end();
    this.#clients.clear();
    if (!this.#server.listening) return;
    await new Promise((resolvePromise, reject) =>
      this.#server.close((error) => (error ? reject(error) : resolvePromise())),
    );
  }

  broadcast(state) {
    const packet = `event: state\ndata: ${JSON.stringify(state)}\n\n`;
    for (const response of this.#clients) response.write(packet);
  }

  async #handle(request, response) {
    securityHeaders(response);
    const base = `http://${this.host}:${this.port}`;
    const url = new URL(request.url, base);
    if (!this.#isAllowedHost(request.headers.host)) {
      return sendJson(response, 421, { error: "Unrecognized Host header" });
    }
    if (!this.#isAllowedOrigin(request.headers.origin)) {
      return sendJson(response, 403, { error: "Cross-origin requests are not allowed" });
    }
    if (url.pathname.startsWith("/api/") && !this.#hasInstanceAccess(request, url)) {
      response.setHeader("Cache-Control", "no-store");
      return sendJson(response, 401, {
        error: "This M18 session requires its private launcher token. Reopen M18 Foundry from its application shortcut.",
      });
    }
    if (methodIsMutation(request.method) && !new Set(["ui", "mcp"]).has(request.headers["x-vsd-local-client"])) {
      return sendJson(response, 403, { error: "Missing local-client header" });
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      return sendJson(response, 200, { ok: true, version: APP_VERSION, pid: process.pid });
    }
    if (request.method === "GET" && url.pathname === "/api/state") {
      return sendJson(response, 200, this.controller.getState());
    }
    if (request.method === "GET" && url.pathname === "/api/events") {
      return this.#openEventStream(request, response);
    }
    if (request.method === "GET" && url.pathname.startsWith("/api/assets/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/assets/".length));
      const asset = await this.controller.assetStore.read(id);
      response.statusCode = 200;
      response.setHeader("Content-Type", asset.contentType);
      response.setHeader("Content-Length", asset.buffer.length);
      response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      return response.end(asset.buffer);
    }
    if (request.method === "POST" && url.pathname === "/api/assets") {
      const buffer = await readBody(request, MAX_ASSET_BYTES);
      const asset = await this.controller.assetStore.save(buffer, request.headers["content-type"]);
      return sendJson(response, 201, { asset });
    }
    if (request.method === "PUT" && url.pathname === "/api/config") {
      const { config, expectedRevision } = await readJson(request);
      await this.controller.replaceConfig(config, expectedRevision);
      return sendJson(response, 200, this.controller.getState());
    }
    if (request.method === "POST" && url.pathname === "/api/profiles") {
      const result = await this.controller.createProfile(await readJson(request));
      return sendJson(response, 201, { ...result, state: this.controller.getState() });
    }
    if (request.method === "POST" && url.pathname === "/api/profiles/active") {
      const body = await readJson(request);
      const result = await this.controller.setActiveProfile({
        profileId: body.profileId,
        apply: Boolean(body.apply),
        expectedRevision: body.expectedRevision,
      });
      return sendJson(response, 200, { result, state: this.controller.getState() });
    }
    if (request.method === "DELETE" && url.pathname.startsWith("/api/profiles/")) {
      const profileId = decodeURIComponent(url.pathname.slice("/api/profiles/".length));
      const { expectedRevision } = await readJson(request);
      await this.controller.deleteProfile({ profileId, expectedRevision });
      return sendJson(response, 200, this.controller.getState());
    }
    if (request.method === "POST" && url.pathname === "/api/device/apply") {
      const body = await readJson(request);
      requireOperationSnapshot(body);
      const result = await this.controller.applyActiveProfile({
        expectedProfileId: body.profileId,
        expectedRevision: body.expectedRevision,
      });
      return sendJson(response, 200, { result, state: this.controller.getState() });
    }
    if (request.method === "POST" && url.pathname === "/api/device/brightness") {
      const body = await readJson(request);
      await this.controller.setBrightness(body);
      return sendJson(response, 200, this.controller.getState());
    }
    if (request.method === "POST" && url.pathname === "/api/device/led") {
      const body = await readJson(request);
      await this.controller.setLedColor(body);
      return sendJson(response, 200, this.controller.getState());
    }
    if (request.method === "POST" && url.pathname === "/api/device/simulate") {
      const body = await readJson(request);
      requireOperationSnapshot(body, { includeAction: true });
      this.controller.simulatePress({
        key: Number(body.key),
        confirm: body.confirm === true,
        expectedProfileId: body.profileId,
        expectedRevision: body.expectedRevision,
        expectedAction: body.expectedAction,
      });
      return sendJson(response, 202, this.controller.getState());
    }
    if (request.method === "POST" && url.pathname === "/api/actions/trigger") {
      const body = await readJson(request);
      requireOperationSnapshot(body, { includeAction: true });
      const result = await this.controller.triggerButton({
        key: Number(body.key),
        confirm: body.confirm === true,
        source: body.source === "mcp" ? "mcp" : "api",
        expectedProfileId: body.profileId,
        expectedRevision: body.expectedRevision,
        expectedAction: body.expectedAction,
      });
      return sendJson(response, 200, { result, state: this.controller.getState() });
    }
    if (url.pathname.startsWith("/api/")) {
      return sendJson(response, 404, { error: "API route not found" });
    }
    if (!new Set(["GET", "HEAD"]).has(request.method)) {
      return sendJson(response, 405, { error: "Method not allowed" });
    }
    return this.#serveStatic(url.pathname, request.method, response);
  }

  #isAllowedHost(hostHeader) {
    if (!hostHeader) return false;
    return new Set([
      `${this.host}:${this.port}`,
      `localhost:${this.port}`,
      `[::1]:${this.port}`,
    ]).has(hostHeader.toLowerCase());
  }

  #isAllowedOrigin(origin) {
    if (!origin) return true;
    return new Set([
      `http://${this.host}:${this.port}`,
      `http://localhost:${this.port}`,
      `http://[::1]:${this.port}`,
    ]).has(origin);
  }

  #hasInstanceAccess(request, url) {
    const supplied =
      request.headers["x-vsd-instance-token"] ||
      (request.method === "GET" ? url.searchParams.get("instance") : null);
    return instanceTokensEqual(supplied, this.instanceToken);
  }

  #openEventStream(request, response) {
    response.statusCode = 200;
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders();
    this.#clients.add(response);
    response.write(`event: state\ndata: ${JSON.stringify(this.controller.getState())}\n\n`);
    request.once("close", () => this.#clients.delete(response));
  }

  async #serveStatic(pathname, method, response) {
    const path = safeStaticPath(pathname);
    if (!path) return sendJson(response, 404, { error: "File not found" });
    let info;
    try {
      info = await stat(path);
    } catch {
      return sendJson(response, 404, { error: "File not found" });
    }
    if (!info.isFile()) return sendJson(response, 404, { error: "File not found" });
    response.statusCode = 200;
    response.setHeader("Content-Type", STATIC_TYPES.get(extname(path)) || "application/octet-stream");
    response.setHeader("Content-Length", info.size);
    response.setHeader("Cache-Control", extname(path) === ".html" ? "no-cache" : "public, max-age=300");
    if (method === "HEAD") return response.end();
    createReadStream(path).pipe(response);
  }

  #handleError(error, response) {
    if (response.headersSent) {
      response.end();
      return;
    }
    const status =
      error.statusCode ||
      (error.code === "ENOENT"
        ? 404
        : error instanceof RevisionConflictError
          ? 409
          : error instanceof TypeError || error instanceof RangeError
            ? 400
            : 500);
    sendJson(response, status, {
      error: errorMessage(error),
      ...(error instanceof RevisionConflictError
        ? { expectedRevision: error.expected, currentRevision: error.actual }
        : {}),
    });
  }
}
