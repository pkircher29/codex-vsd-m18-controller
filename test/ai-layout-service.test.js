import assert from "node:assert/strict";
import test from "node:test";
import { AiLayoutService, validateAiLayout } from "../src/ai-layout-service.js";

function layoutFixture() {
  return {
    summary: "Streaming controls",
    keys: Array.from({ length: 18 }, (_, offset) => ({
      index: offset + 1,
      label: `KEY ${offset + 1}`,
      color: offset % 2 ? "#285A77" : "#C47A32",
      action: {
        type: offset === 0 ? "command" : "none",
        executable: offset === 0 ? "/usr/bin/playerctl" : "",
        args: offset === 0 ? ["play-pause"] : [],
        url: "",
      },
    })),
  };
}

test("AI model discovery supports Ollama and account-scoped OpenAI models", async () => {
  const requests = [];
  const service = new AiLayoutService({
    fetchImplementation: async (url, options) => {
      requests.push({ url, options });
      if (url.includes("11434")) {
        return new Response(JSON.stringify({ models: [{ name: "qwen3" }, { name: "gemma3" }] }));
      }
      return new Response(JSON.stringify({ data: [{ id: "gpt-example" }] }));
    },
  });

  const local = await service.listModels({ provider: "ollama", baseUrl: "http://127.0.0.1:11434" });
  assert.deepEqual(local.models, ["gemma3", "qwen3"]);
  const cloud = await service.listModels({ provider: "openai", apiKey: "test-key" });
  assert.deepEqual(cloud.models, ["gpt-example"]);
  assert.equal(requests[0].url, "http://127.0.0.1:11434/api/tags");
  assert.equal(requests[1].url, "https://api.openai.com/v1/models");
  assert.equal(requests[1].options.headers.Authorization, "Bearer test-key");
});

test("OpenAI-compatible layout generation returns a validated 18-key draft", async () => {
  let requestBody;
  const service = new AiLayoutService({
    fetchImplementation: async (url, options) => {
      assert.equal(url, "http://127.0.0.1:1234/v1/chat/completions");
      requestBody = JSON.parse(options.body);
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(layoutFixture()) } }],
      }));
    },
  });
  const result = await service.generate({
    provider: "openai-compatible",
    baseUrl: "http://127.0.0.1:1234/v1",
    model: "local-model",
    prompt: "Make streaming controls",
    platform: "Linux",
    scope: "all",
    profile: { keys: [] },
  });
  assert.equal(result.layout.keys.length, 18);
  assert.deepEqual(result.layout.keys[0].action, {
    type: "command",
    executable: "/usr/bin/playerctl",
    args: ["play-pause"],
  });
  assert.equal(requestBody.response_format.type, "json_object");
  assert.match(requestBody.messages[1].content, /never generate shell operators/i);
});

test("OAuth credentials authorize Google Gemini and OpenRouter without exposing browser tokens", async () => {
  const requests = [];
  const service = new AiLayoutService({
    fetchImplementation: async (url, options) => {
      requests.push({ url, options });
      if (url.includes("generativelanguage.googleapis.com")) {
        return new Response(JSON.stringify({
          models: [{ name: "models/gemini-oauth", supportedGenerationMethods: ["generateContent"] }],
        }));
      }
      if (url.endsWith("/models")) {
        return new Response(JSON.stringify({ data: [{ id: "anthropic/claude-example" }] }));
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(layoutFixture()) } }],
      }));
    },
  });

  const google = await service.listModels({
    provider: "gemini",
    oauthAccessToken: "google-oauth-access",
    oauthProjectId: "m18-project",
  });
  assert.deepEqual(google.models, ["gemini-oauth"]);
  assert.equal(requests[0].options.headers.Authorization, "Bearer google-oauth-access");
  assert.equal(requests[0].options.headers["x-goog-user-project"], "m18-project");
  assert.equal(requests[0].options.headers["x-goog-api-key"], undefined);

  const models = await service.listModels({ provider: "openrouter", apiKey: "openrouter-key" });
  assert.deepEqual(models.models, ["anthropic/claude-example"]);
  const generated = await service.generate({
    provider: "openrouter",
    apiKey: "openrouter-key",
    model: "anthropic/claude-example",
    prompt: "Build a broadcast layout",
    scope: "all",
    profile: { keys: [] },
  });
  assert.equal(generated.layout.keys.length, 18);
  assert.equal(requests[1].options.headers.Authorization, "Bearer openrouter-key");
  assert.equal(requests[2].url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(requests[2].options.headers.Authorization, "Bearer openrouter-key");
});

test("AI layout validation rejects duplicate indexes and unsafe URL protocols", () => {
  const duplicate = layoutFixture();
  duplicate.keys[1].index = 1;
  assert.throws(() => validateAiLayout(duplicate), /unique numbers/);

  const unsafe = layoutFixture();
  unsafe.keys[2].action = {
    type: "url",
    executable: "",
    args: [],
    url: "file:///etc/passwd",
  };
  assert.throws(() => validateAiLayout(unsafe), /invalid web address/);

  const destructive = layoutFixture();
  destructive.keys[3].action = {
    type: "command",
    executable: "/usr/bin/rm",
    args: ["-rf", "/tmp/example"],
    url: "",
  };
  assert.throws(() => validateAiLayout(destructive), /must be assigned manually/);
});

test("AI generation reports provider timeouts with a recoverable message", async () => {
  const service = new AiLayoutService({
    fetchImplementation: async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    },
  });

  await assert.rejects(
    () => service.generate({
      provider: "openrouter",
      apiKey: "test-key",
      model: "test/model",
      prompt: "Create a useful streaming layout",
    }),
    (error) => {
      assert.equal(error.statusCode, 504);
      assert.match(error.message, /did not respond within 180 seconds/i);
      assert.match(error.message, /try again or choose another model/i);
      return true;
    },
  );
});
