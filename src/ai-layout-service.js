const PROVIDERS = new Set(["ollama", "openrouter", "openai", "anthropic", "gemini", "openai-compatible"]);
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const MAX_PROMPT_LENGTH = 12_000;
const MAX_PROVIDER_ERROR_LENGTH = 700;

const LAYOUT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string", maxLength: 240 },
    keys: {
      type: "array",
      minItems: 18,
      maxItems: 18,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          index: { type: "integer", minimum: 1, maximum: 18 },
          label: { type: "string", maxLength: 16 },
          color: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
          action: {
            type: "object",
            additionalProperties: false,
            properties: {
              type: { type: "string", enum: ["none", "command", "url"] },
              executable: { type: "string", maxLength: 1024 },
              args: {
                type: "array",
                maxItems: 64,
                items: { type: "string", maxLength: 2048 },
              },
              url: { type: "string", maxLength: 4096 },
            },
            required: ["type", "executable", "args", "url"],
          },
        },
        required: ["index", "label", "color", "action"],
      },
    },
  },
  required: ["summary", "keys"],
});

function serviceError(message, statusCode = 502) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function requiredText(value, label, maximum = 1024) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw serviceError(`${label} is required`, 400);
  }
  const clean = value.trim();
  if (clean.length > maximum || clean.includes("\0")) {
    throw serviceError(`${label} is too long or contains an invalid character`, 400);
  }
  return clean;
}

function optionalText(value, maximum = 4096) {
  if (value == null) return "";
  if (typeof value !== "string" || value.length > maximum || value.includes("\0")) {
    throw serviceError("AI provider input is invalid", 400);
  }
  return value.trim();
}

function providerName(value) {
  const provider = requiredText(value, "AI provider", 40).toLowerCase();
  if (!PROVIDERS.has(provider)) throw serviceError("AI provider is not supported", 400);
  return provider;
}

function normalizeEndpoint(provider, supplied) {
  const defaults = {
    ollama: "http://127.0.0.1:11434",
    "openai-compatible": "http://127.0.0.1:1234/v1",
  };
  const raw = optionalText(supplied, 2048) || defaults[provider];
  if (!raw) return null;
  let endpoint;
  try {
    endpoint = new URL(raw);
  } catch {
    throw serviceError("AI endpoint must be a valid HTTP or HTTPS address", 400);
  }
  if (!new Set(["http:", "https:"]).has(endpoint.protocol)) {
    throw serviceError("AI endpoint must use HTTP or HTTPS", 400);
  }
  if (endpoint.username || endpoint.password) {
    throw serviceError("Put credentials in the API key field, not in the endpoint URL", 400);
  }
  endpoint.hash = "";
  endpoint.search = "";
  endpoint.pathname = endpoint.pathname.replace(/\/+$/, "");
  return endpoint.toString().replace(/\/$/, "");
}

function withPath(base, path) {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function cloudHeaders(provider, apiKey, input = {}) {
  if (provider === "gemini" && input.oauthAccessToken) {
    return {
      Authorization: `Bearer ${requiredText(input.oauthAccessToken, "OAuth access token", 8192)}`,
      "x-goog-user-project": requiredText(input.oauthProjectId, "Google Cloud project ID", 128),
    };
  }
  const key = requiredText(apiKey, "API key", 4096);
  if (new Set(["openai", "openrouter"]).has(provider)) return { Authorization: `Bearer ${key}` };
  if (provider === "anthropic") {
    return { "x-api-key": key, "anthropic-version": "2023-06-01" };
  }
  if (provider === "gemini") return { "x-goog-api-key": key };
  return {};
}

function customHeaders(apiKey) {
  const key = optionalText(apiKey, 4096);
  return key ? { Authorization: `Bearer ${key}` } : {};
}

async function readProviderResponse(response) {
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = null;
  }
  if (!response.ok) {
    const detail =
      body?.error?.message ||
      body?.error ||
      body?.message ||
      text ||
      `HTTP ${response.status}`;
    throw serviceError(
      `AI provider rejected the request: ${String(detail).slice(0, MAX_PROVIDER_ERROR_LENGTH)}`,
      502,
    );
  }
  if (!body || typeof body !== "object") {
    throw serviceError("AI provider returned a non-JSON response");
  }
  return body;
}

async function providerFetch(fetchImplementation, url, options = {}, timeout = 60_000) {
  let response;
  try {
    response = await fetchImplementation(url, {
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
      signal: AbortSignal.timeout(timeout),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "connection failed";
    throw serviceError(`Could not reach the AI provider: ${reason}`);
  }
  return readProviderResponse(response);
}

function uniqueModels(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))]
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

function extractJson(text) {
  if (typeof text !== "string" || !text.trim()) {
    throw serviceError("AI provider returned no layout content");
  }
  let clean = text.trim();
  clean = clean.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    return JSON.parse(clean);
  } catch {
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(clean.slice(start, end + 1));
      } catch {
        // Fall through to the provider-output error below.
      }
    }
  }
  throw serviceError("AI provider did not return a valid JSON layout");
}

function cleanAction(raw, index) {
  const action = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const type = new Set(["none", "command", "url"]).has(action.type) ? action.type : "none";
  if (type === "none") return { type: "none" };
  if (type === "command") {
    const executable = optionalText(action.executable, 1024);
    if (!executable) throw serviceError(`AI layout key ${index} has an incomplete command`);
    const args = Array.isArray(action.args) ? action.args : [];
    if (args.length > 64 || args.some((arg) => typeof arg !== "string" || arg.length > 2048 || arg.includes("\0"))) {
      throw serviceError(`AI layout key ${index} has invalid command arguments`);
    }
    const leaf = executable.split(/[\\/]/).at(-1).toLowerCase().replace(/\.exe$/, "");
    const blockedExecutables = new Set([
      "bash", "cmd", "command", "dash", "dd", "del", "doas", "fish", "format", "halt",
      "ksh", "pkill", "poweroff", "powershell", "pwsh", "reboot", "reg", "rm", "sh",
      "shutdown", "su", "sudo", "taskkill", "zsh",
    ]);
    const interpreters = new Set(["node", "nodejs", "perl", "python", "python3", "ruby"]);
    if (
      blockedExecutables.has(leaf) ||
      leaf.startsWith("mkfs") ||
      (interpreters.has(leaf) && args.some((arg) => new Set(["-c", "-e", "--eval"]).has(arg)))
    ) {
      throw serviceError(`AI layout key ${index} proposed a command that must be assigned manually`);
    }
    return { type, executable, args };
  }
  const url = optionalText(action.url, 4096);
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    parsed = null;
  }
  if (!parsed || !new Set(["http:", "https:"]).has(parsed.protocol)) {
    throw serviceError(`AI layout key ${index} has an invalid web address`);
  }
  return { type, url: parsed.toString() };
}

export function validateAiLayout(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Array.isArray(raw.keys)) {
    throw serviceError("AI provider returned an invalid layout shape");
  }
  if (raw.keys.length !== 18) {
    throw serviceError(`AI layout must contain exactly 18 keys; received ${raw.keys.length}`);
  }
  const seen = new Set();
  const keys = raw.keys.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw serviceError("AI layout contains an invalid key entry");
    }
    const index = Number(entry.index);
    if (!Number.isInteger(index) || index < 1 || index > 18 || seen.has(index)) {
      throw serviceError("AI layout key indexes must be unique numbers from 1 through 18");
    }
    seen.add(index);
    const label = optionalText(entry.label, 32);
    const color = optionalText(entry.color, 7).toUpperCase();
    if (!HEX_COLOR.test(color)) throw serviceError(`AI layout key ${index} has an invalid color`);
    return { index, label, color, action: cleanAction(entry.action, index) };
  });
  keys.sort((left, right) => left.index - right.index);
  return {
    summary: optionalText(raw.summary, 240) || "AI-generated M18 layout",
    keys,
  };
}

function currentLayout(profile) {
  if (!profile || typeof profile !== "object" || !Array.isArray(profile.keys)) return [];
  return profile.keys.slice(0, 18).map((key) => ({
    index: Number(key.index),
    label: typeof key.label === "string" ? key.label.slice(0, 32) : "",
    color: HEX_COLOR.test(key.color || "") ? key.color.toUpperCase() : "#6F6252",
    action: key.action && typeof key.action === "object" ? key.action : { type: "none" },
  }));
}

function layoutInstructions({ prompt, profile, platform, scope }) {
  const existing = currentLayout(profile);
  const mode = scope === "empty" ? "Keep every already-assigned key unchanged and redesign only keys whose action is none." : "Redesign all 18 keys.";
  return [
    "Design one practical M18 stream-dock profile from the user's request.",
    "The dock has LCD keys 1-15 and non-display chassis buttons 16-18.",
    "Return exactly 18 unique key entries in numeric order.",
    "Labels should be short, recognizable, and at most 16 characters. Use varied high-contrast hex colors.",
    "Allowed actions are none, command, or url. A command is a direct executable plus an exact argument array; it does not run through a shell.",
    "Never generate shell operators, pipes, redirects, command substitution, sudo, package installation, deletion, disk formatting, shutdown, credential access, or privilege escalation.",
    "When the executable is uncertain for the target platform, use action type none instead of inventing a dangerous command.",
    "For every action object, include type, executable, args, and url; use empty values for fields that do not apply.",
    mode,
    `Target platform: ${platform || "local desktop"}.`,
    `Current layout: ${JSON.stringify(existing)}.`,
    `User request: ${prompt}`,
  ].join("\n");
}

function extractOpenAiText(body) {
  if (typeof body.output_text === "string") return body.output_text;
  for (const item of body.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return "";
}

function extractMessageText(body) {
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => part?.text || "").join("");
  return "";
}

export class AiLayoutService {
  constructor({ fetchImplementation = fetch } = {}) {
    this.fetchImplementation = fetchImplementation;
  }

  async listModels(input = {}) {
    const provider = providerName(input.provider);
    const apiKey = optionalText(input.apiKey, 4096);
    let body;
    if (provider === "openai") {
      body = await providerFetch(
        this.fetchImplementation,
        "https://api.openai.com/v1/models",
        { headers: cloudHeaders(provider, apiKey, input) },
        20_000,
      );
      return { provider, models: uniqueModels((body.data || []).map((model) => model?.id)) };
    }
    if (provider === "anthropic") {
      body = await providerFetch(
        this.fetchImplementation,
        "https://api.anthropic.com/v1/models?limit=1000",
        { headers: cloudHeaders(provider, apiKey, input) },
        20_000,
      );
      return { provider, models: uniqueModels((body.data || []).map((model) => model?.id)) };
    }
    if (provider === "gemini") {
      body = await providerFetch(
        this.fetchImplementation,
        "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
        { headers: cloudHeaders(provider, apiKey, input) },
        20_000,
      );
      const models = (body.models || [])
        .filter((model) => (model?.supportedGenerationMethods || []).includes("generateContent"))
        .map((model) => String(model?.name || "").replace(/^models\//, ""));
      return { provider, models: uniqueModels(models) };
    }
    if (provider === "openrouter") {
      body = await providerFetch(
        this.fetchImplementation,
        "https://openrouter.ai/api/v1/models",
        { headers: cloudHeaders(provider, apiKey, input) },
        20_000,
      );
      return { provider, models: uniqueModels((body.data || []).map((model) => model?.id)) };
    }
    const endpoint = normalizeEndpoint(provider, input.baseUrl);
    if (provider === "ollama") {
      body = await providerFetch(this.fetchImplementation, withPath(endpoint, "/api/tags"), {}, 20_000);
      return { provider, endpoint, models: uniqueModels((body.models || []).map((model) => model?.name || model?.model)) };
    }
    body = await providerFetch(
      this.fetchImplementation,
      withPath(endpoint, "/models"),
      { headers: customHeaders(apiKey) },
      20_000,
    );
    return { provider, endpoint, models: uniqueModels((body.data || body.models || []).map((model) => model?.id || model?.name || model)) };
  }

  async generate(input = {}) {
    const provider = providerName(input.provider);
    const model = requiredText(input.model, "AI model", 256);
    const prompt = requiredText(input.prompt, "Layout request", MAX_PROMPT_LENGTH);
    const apiKey = optionalText(input.apiKey, 4096);
    const instructions = layoutInstructions({
      prompt,
      profile: input.profile,
      platform: optionalText(input.platform, 80),
      scope: input.scope === "empty" ? "empty" : "all",
    });
    let body;
    let text;

    if (provider === "openai") {
      body = await providerFetch(this.fetchImplementation, "https://api.openai.com/v1/responses", {
        method: "POST",
        headers: cloudHeaders(provider, apiKey, input),
        body: JSON.stringify({
          model,
          input: instructions,
          store: false,
          text: {
            format: {
              type: "json_schema",
              name: "m18_layout",
              strict: true,
              schema: LAYOUT_SCHEMA,
            },
          },
        }),
      });
      text = extractOpenAiText(body);
    } else if (provider === "anthropic") {
      body = await providerFetch(this.fetchImplementation, "https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: cloudHeaders(provider, apiKey, input),
        body: JSON.stringify({
          model,
          max_tokens: 5000,
          system: "You are a cautious interface designer for a local 18-button stream dock.",
          messages: [{ role: "user", content: instructions }],
          output_config: { format: { type: "json_schema", schema: LAYOUT_SCHEMA } },
        }),
      });
      text = (body.content || []).filter((block) => block?.type === "text").map((block) => block.text).join("");
    } else if (provider === "gemini") {
      const encodedModel = encodeURIComponent(model.replace(/^models\//, ""));
      body = await providerFetch(
        this.fetchImplementation,
        `https://generativelanguage.googleapis.com/v1beta/models/${encodedModel}:generateContent`,
        {
          method: "POST",
          headers: cloudHeaders(provider, apiKey, input),
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: instructions }] }],
            generationConfig: { responseMimeType: "application/json", responseSchema: LAYOUT_SCHEMA },
          }),
        },
      );
      text = (body.candidates?.[0]?.content?.parts || []).map((part) => part?.text || "").join("");
    } else if (provider === "openrouter") {
      body = await providerFetch(this.fetchImplementation, "https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: cloudHeaders(provider, apiKey, input),
        body: JSON.stringify({
          model,
          temperature: 0.2,
          messages: [
            { role: "system", content: "Return only valid JSON for an M18 stream-dock layout." },
            { role: "user", content: instructions },
          ],
          response_format: { type: "json_object" },
        }),
      });
      text = extractMessageText(body);
    } else if (provider === "ollama") {
      const endpoint = normalizeEndpoint(provider, input.baseUrl);
      body = await providerFetch(this.fetchImplementation, withPath(endpoint, "/api/chat"), {
        method: "POST",
        body: JSON.stringify({
          model,
          stream: false,
          messages: [{ role: "user", content: instructions }],
          format: LAYOUT_SCHEMA,
          options: { temperature: 0.2 },
        }),
      });
      text = body.message?.content || "";
    } else {
      const endpoint = normalizeEndpoint(provider, input.baseUrl);
      body = await providerFetch(this.fetchImplementation, withPath(endpoint, "/chat/completions"), {
        method: "POST",
        headers: customHeaders(apiKey),
        body: JSON.stringify({
          model,
          temperature: 0.2,
          messages: [
            { role: "system", content: "Return only valid JSON for an M18 stream-dock layout." },
            { role: "user", content: instructions },
          ],
          response_format: { type: "json_object" },
        }),
      });
      text = extractMessageText(body);
    }

    return { provider, model, layout: validateAiLayout(extractJson(text)) };
  }
}

export { LAYOUT_SCHEMA };
