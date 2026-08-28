import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { AiOauthService, GOOGLE_SCOPES } from "../src/ai-oauth-service.js";

test("OpenRouter OAuth uses PKCE and exchanges a single-use callback for a local connection", async () => {
  const requests = [];
  const service = new AiOauthService({
    fetchImplementation: async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify({ key: "openrouter-session-key" }));
    },
  });
  const started = service.start(
    { provider: "openrouter" },
    { baseUrl: "http://127.0.0.1:43123" },
  );
  const authorization = new URL(started.authorizationUrl);
  const callback = new URL(authorization.searchParams.get("callback_url"));
  assert.equal(authorization.origin, "https://openrouter.ai");
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
  assert.equal(callback.origin, "http://127.0.0.1:43123");
  assert.match(callback.pathname, /^\/api\/ai\/oauth\/callback\/openrouter\/[A-Za-z0-9_-]{32}$/);
  assert.equal(callback.search, "");
  const flowId = callback.pathname.split("/").at(-1);

  const completed = await service.complete("openrouter", {
    flow: flowId,
    code: "one-time-code",
  });
  assert.equal(completed.provider, "openrouter");
  assert.equal(service.status({ provider: "openrouter", oauthConnectionId: completed.connectionId }).connected, true);
  const authorized = await service.authorize({
    provider: "openrouter",
    oauthConnectionId: completed.connectionId,
  });
  assert.equal(authorized.apiKey, "openrouter-session-key");
  assert.equal(authorized.oauthConnectionId, undefined);

  assert.equal(requests[0].url, "https://openrouter.ai/api/v1/auth/keys");
  const exchanged = JSON.parse(requests[0].options.body);
  assert.equal(exchanged.code, "one-time-code");
  assert.equal(exchanged.code_challenge_method, "S256");
  assert.equal(
    createHash("sha256").update(exchanged.code_verifier).digest("base64url"),
    authorization.searchParams.get("code_challenge"),
  );
  await assert.rejects(
    () => service.complete("openrouter", { flow: flowId, code: "again" }),
    /expired/i,
  );
  assert.deepEqual(service.disconnect({
    provider: "openrouter",
    oauthConnectionId: completed.connectionId,
  }), { provider: "openrouter", disconnected: true });
});

test("Google OAuth verifies state, carries project quota, and refreshes expired access", async () => {
  let now = 1_000;
  const requests = [];
  const service = new AiOauthService({
    now: () => now,
    fetchImplementation: async (url, options) => {
      requests.push({ url, options });
      if (requests.length === 1) {
        return new Response(JSON.stringify({
          access_token: "google-access-one",
          refresh_token: "google-refresh",
          expires_in: 3600,
        }));
      }
      return new Response(JSON.stringify({ access_token: "google-access-two", expires_in: 3600 }));
    },
  });
  const started = service.start({
    provider: "gemini",
    clientId: "desktop-client.apps.googleusercontent.com",
    clientSecret: "desktop-secret",
    projectId: "m18-foundry-project",
  }, { baseUrl: "http://127.0.0.1:43123" });
  const authorization = new URL(started.authorizationUrl);
  const callback = new URL(authorization.searchParams.get("redirect_uri"));
  assert.equal(authorization.origin, "https://accounts.google.com");
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
  assert.deepEqual(
    authorization.searchParams.get("scope").split(" "),
    GOOGLE_SCOPES,
  );

  const completed = await service.complete("gemini", {
    state: authorization.searchParams.get("state"),
    code: "google-code",
  });
  const first = await service.authorize({
    provider: "gemini",
    oauthConnectionId: completed.connectionId,
  });
  assert.equal(first.oauthAccessToken, "google-access-one");
  assert.equal(first.oauthProjectId, "m18-foundry-project");
  const exchange = new URLSearchParams(requests[0].options.body);
  assert.equal(exchange.get("client_id"), "desktop-client.apps.googleusercontent.com");
  assert.equal(exchange.get("client_secret"), "desktop-secret");
  assert.equal(exchange.get("redirect_uri"), authorization.searchParams.get("redirect_uri"));
  assert.ok(exchange.get("code_verifier"));

  now += 3_599_500;
  const refreshed = await service.authorize({
    provider: "gemini",
    oauthConnectionId: completed.connectionId,
  });
  assert.equal(refreshed.oauthAccessToken, "google-access-two");
  assert.equal(requests[1].url, "https://oauth2.googleapis.com/token");
  const refresh = new URLSearchParams(requests[1].options.body);
  assert.equal(refresh.get("grant_type"), "refresh_token");
  assert.equal(refresh.get("refresh_token"), "google-refresh");
});

test("Google OAuth rejects mismatched callback state and unknown connections", async () => {
  const service = new AiOauthService();
  const started = service.start({
    provider: "gemini",
    clientId: "desktop-client.apps.googleusercontent.com",
    projectId: "m18-project",
  }, { baseUrl: "http://localhost:43123" });
  const authorization = new URL(started.authorizationUrl);
  const callback = new URL(authorization.searchParams.get("redirect_uri"));
  assert.equal(callback.pathname, "/");
  assert.equal(callback.search, "");
  await assert.rejects(
    () => service.complete("gemini", {
      flow: authorization.searchParams.get("state"),
      state: "wrong-state",
      code: "unused-code",
    }),
    /state verification/i,
  );
  await assert.rejects(
    () => service.authorize({ provider: "openrouter", oauthConnectionId: "missing" }),
    /sign in again/i,
  );
});
