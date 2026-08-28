import { createHash, randomBytes } from "node:crypto";

const OAUTH_PROVIDERS = new Set(["openrouter", "gemini"]);
const FLOW_TTL_MS = 10 * 60 * 1000;
const MAX_FLOWS = 32;
const MAX_CONNECTIONS = 16;
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/generative-language.retriever",
];

function oauthError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function requiredText(value, label, maximum = 2048) {
  if (typeof value !== "string" || !value.trim()) throw oauthError(`${label} is required`);
  const clean = value.trim();
  if (clean.length > maximum || clean.includes("\0")) throw oauthError(`${label} is invalid`);
  return clean;
}

function optionalText(value, maximum = 4096) {
  if (value == null || value === "") return "";
  if (typeof value !== "string" || value.length > maximum || value.includes("\0")) {
    throw oauthError("OAuth configuration is invalid");
  }
  return value.trim();
}

function providerName(value) {
  const provider = requiredText(value, "OAuth provider", 40).toLowerCase();
  if (!OAUTH_PROVIDERS.has(provider)) throw oauthError("This AI provider does not support OAuth here");
  return provider;
}

function loopbackBaseUrl(value) {
  let url;
  try {
    url = new URL(requiredText(value, "Local callback address"));
  } catch {
    throw oauthError("Local callback address is invalid");
  }
  if (url.protocol !== "http:" || !new Set(["127.0.0.1", "localhost", "[::1]"]).has(url.hostname)) {
    throw oauthError("OAuth callbacks must use this controller's loopback address");
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function codeChallenge(verifier) {
  return createHash("sha256").update(verifier).digest("base64url");
}

async function tokenResponse(fetchImplementation, url, options) {
  let response;
  try {
    response = await fetchImplementation(url, {
      ...options,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "connection failed";
    throw oauthError(`Could not reach the OAuth provider: ${reason}`, 502);
  }
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = null;
  }
  if (!response.ok || !body || typeof body !== "object") {
    const detail = body?.error_description || body?.error?.message || body?.error || body?.message;
    throw oauthError(
      `OAuth sign-in failed${detail ? `: ${String(detail).slice(0, 400)}` : ` with HTTP ${response.status}`}`,
      502,
    );
  }
  return body;
}

export class AiOauthService {
  constructor({ fetchImplementation = fetch, now = Date.now } = {}) {
    this.fetchImplementation = fetchImplementation;
    this.now = now;
    this.flows = new Map();
    this.connections = new Map();
  }

  start(input = {}, { baseUrl } = {}) {
    this.#prune();
    const provider = providerName(input.provider);
    const flowId = randomToken(24);
    const verifier = randomToken(48);
    const state = flowId;
    const localBaseUrl = loopbackBaseUrl(baseUrl);
    const callbackUrl = provider === "gemini"
      ? localBaseUrl
      : `${localBaseUrl}/api/ai/oauth/callback/${provider}?flow=${encodeURIComponent(flowId)}`;
    const flow = {
      id: flowId,
      provider,
      verifier,
      state,
      callbackUrl,
      createdAt: this.now(),
    };
    let authorizationUrl;

    if (provider === "openrouter") {
      authorizationUrl = new URL("https://openrouter.ai/auth");
      authorizationUrl.searchParams.set("callback_url", callbackUrl);
      authorizationUrl.searchParams.set("code_challenge", codeChallenge(verifier));
      authorizationUrl.searchParams.set("code_challenge_method", "S256");
      authorizationUrl.searchParams.set("key_label", "M18 Foundry");
    } else {
      flow.clientId = requiredText(input.clientId, "Google OAuth client ID");
      flow.clientSecret = optionalText(input.clientSecret);
      flow.projectId = requiredText(input.projectId, "Google Cloud project ID", 128);
      if (!/^[a-z0-9][a-z0-9._:-]{1,126}[a-z0-9]$/i.test(flow.projectId)) {
        throw oauthError("Google Cloud project ID contains invalid characters");
      }
      authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authorizationUrl.searchParams.set("client_id", flow.clientId);
      authorizationUrl.searchParams.set("redirect_uri", callbackUrl);
      authorizationUrl.searchParams.set("response_type", "code");
      authorizationUrl.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
      authorizationUrl.searchParams.set("state", state);
      authorizationUrl.searchParams.set("code_challenge", codeChallenge(verifier));
      authorizationUrl.searchParams.set("code_challenge_method", "S256");
      authorizationUrl.searchParams.set("access_type", "offline");
      authorizationUrl.searchParams.set("prompt", "consent");
      authorizationUrl.searchParams.set("include_granted_scopes", "true");
    }

    this.#limit(this.flows, MAX_FLOWS);
    this.flows.set(flowId, flow);
    return {
      provider,
      authorizationUrl: authorizationUrl.toString(),
      expiresIn: Math.floor(FLOW_TTL_MS / 1000),
    };
  }

  async complete(providerValue, query = {}) {
    this.#prune();
    const provider = providerName(providerValue);
    const flowId = requiredText(query.flow || (provider === "gemini" ? query.state : ""), "OAuth flow", 128);
    const flow = this.flows.get(flowId);
    if (!flow || flow.provider !== provider) throw oauthError("This OAuth sign-in expired. Start again.");
    this.flows.delete(flowId);
    if (query.error) {
      const detail = optionalText(query.error_description, 300) || optionalText(query.error, 120);
      throw oauthError(`OAuth sign-in was not completed${detail ? `: ${detail}` : ""}`);
    }
    if (provider === "gemini" && query.state !== flow.state) {
      throw oauthError("OAuth state verification failed");
    }
    const code = requiredText(query.code, "OAuth authorization code", 4096);
    const connectionId = randomToken(32);
    let connection;

    if (provider === "openrouter") {
      const body = await tokenResponse(
        this.fetchImplementation,
        "https://openrouter.ai/api/v1/auth/keys",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code,
            code_verifier: flow.verifier,
            code_challenge_method: "S256",
          }),
        },
      );
      connection = {
        provider,
        credential: requiredText(body.key, "OpenRouter credential", 4096),
        createdAt: this.now(),
      };
    } else {
      const parameters = new URLSearchParams({
        client_id: flow.clientId,
        code,
        code_verifier: flow.verifier,
        grant_type: "authorization_code",
        redirect_uri: flow.callbackUrl,
      });
      if (flow.clientSecret) parameters.set("client_secret", flow.clientSecret);
      const body = await tokenResponse(
        this.fetchImplementation,
        "https://oauth2.googleapis.com/token",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: parameters.toString(),
        },
      );
      connection = {
        provider,
        accessToken: requiredText(body.access_token, "Google access token", 8192),
        refreshToken: optionalText(body.refresh_token, 8192),
        expiresAt: this.now() + Math.max(30, Number(body.expires_in) || 3600) * 1000,
        clientId: flow.clientId,
        clientSecret: flow.clientSecret,
        projectId: flow.projectId,
        createdAt: this.now(),
      };
    }

    this.#limit(this.connections, MAX_CONNECTIONS);
    this.connections.set(connectionId, connection);
    return { provider, connectionId };
  }

  async authorize(input = {}) {
    const connectionId = optionalText(input.oauthConnectionId, 128);
    if (!connectionId) return input;
    const provider = providerName(input.provider);
    const connection = this.connections.get(connectionId);
    if (!connection || connection.provider !== provider) {
      throw oauthError("OAuth connection is no longer available. Sign in again.", 401);
    }
    if (provider === "gemini") await this.#refreshGoogle(connection);
    const authorized = { ...input };
    delete authorized.oauthConnectionId;
    if (provider === "openrouter") authorized.apiKey = connection.credential;
    else {
      authorized.oauthAccessToken = connection.accessToken;
      authorized.oauthProjectId = connection.projectId;
    }
    return authorized;
  }

  status(input = {}) {
    const provider = providerName(input.provider);
    const connectionId = optionalText(input.oauthConnectionId, 128);
    const connection = connectionId ? this.connections.get(connectionId) : null;
    return {
      provider,
      connected: Boolean(connection && connection.provider === provider),
      authentication: connection && connection.provider === provider ? "oauth" : null,
    };
  }

  disconnect(input = {}) {
    const provider = providerName(input.provider);
    const connectionId = optionalText(input.oauthConnectionId, 128);
    const connection = connectionId ? this.connections.get(connectionId) : null;
    const disconnected = Boolean(connection && connection.provider === provider);
    if (disconnected) this.connections.delete(connectionId);
    return { provider, disconnected };
  }

  async #refreshGoogle(connection) {
    if (connection.expiresAt - this.now() > 60_000) return;
    if (!connection.refreshToken) throw oauthError("Google OAuth session expired. Sign in again.", 401);
    const parameters = new URLSearchParams({
      client_id: connection.clientId,
      refresh_token: connection.refreshToken,
      grant_type: "refresh_token",
    });
    if (connection.clientSecret) parameters.set("client_secret", connection.clientSecret);
    const body = await tokenResponse(
      this.fetchImplementation,
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: parameters.toString(),
      },
    );
    connection.accessToken = requiredText(body.access_token, "Google access token", 8192);
    connection.expiresAt = this.now() + Math.max(30, Number(body.expires_in) || 3600) * 1000;
    if (body.refresh_token) connection.refreshToken = optionalText(body.refresh_token, 8192);
  }

  #prune() {
    const oldestFlow = this.now() - FLOW_TTL_MS;
    for (const [id, flow] of this.flows) {
      if (flow.createdAt < oldestFlow) this.flows.delete(id);
    }
  }

  #limit(map, maximum) {
    while (map.size >= maximum) map.delete(map.keys().next().value);
  }
}

export { GOOGLE_SCOPES };
