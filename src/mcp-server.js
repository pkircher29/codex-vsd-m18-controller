#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as z from "zod/v4";
import { APP_VERSION, KEY_COUNT } from "./constants.js";
import { ServiceClient } from "./service-client.js";
import { errorMessage } from "./util.js";

const safeIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/);
const assetIdSchema = z.string().regex(/^[a-f0-9]{64}\.(?:jpg|png|webp|gif)$/);
const httpUrlSchema = z.string().url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
}, "URL must use HTTP or HTTPS");

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({
    type: z.literal("command"),
    executable: z.string().min(1).max(1024),
    args: z.array(z.string().max(2048)).max(64).default([]),
  }),
  z.object({ type: z.literal("url"), url: httpUrlSchema }),
  z.object({ type: z.literal("profile"), profileId: safeIdSchema }),
]);

const updateKeySchema = z.object({
  profile_id: safeIdSchema,
  key: z.number().int().min(1).max(KEY_COUNT),
  expected_revision: z.number().int().nonnegative(),
  label: z.string().max(32).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  asset_id: assetIdSchema.nullable().optional(),
  action: actionSchema.optional(),
}).superRefine((value, context) => {
  if (value.key > 15 && value.asset_id) {
    context.addIssue({
      code: "custom",
      path: ["asset_id"],
      message: "Artwork is available only for LCD keys 1 through 15",
    });
  }
});

function toolResult(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function toolError(error) {
  return {
    content: [{ type: "text", text: `M18 controller error: ${errorMessage(error)}` }],
    isError: true,
  };
}

function withErrors(handler) {
  return async (input, context) => {
    try {
      return await handler(input, context);
    } catch (error) {
      return toolError(error);
    }
  };
}

function activeProfile(state) {
  return state.config.profiles.find((profile) => profile.id === state.config.activeProfileId);
}

export function createM18McpServer({ client = new ServiceClient() } = {}) {
  const server = new McpServer(
    { name: "vsd-m18-controller", version: APP_VERSION },
    {
      instructions:
        "Inspect dock_status before mutating configuration. Configuration writes use optimistic revisions. update_key saves configuration but apply_profile is the explicit hardware-display commit. Bind apply and trigger calls to the inspected profile and revision, and include the exact inspected action when triggering. Never trigger a command or URL unless the user explicitly asked to execute that action.",
    },
  );

  server.registerTool(
    "dock_status",
    {
      title: "Inspect M18 status",
      description: "Read connection, permission, operation, active profile, and configuration revision state.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    withErrors(async () => {
      const state = await client.getState();
      const profile = activeProfile(state);
      return toolResult({
        device: state.device,
        appliedState: state.appliedState,
        operation: state.operation,
        lastEvent: state.lastEvent,
        recoveryNotice: state.recoveryNotice,
        revision: state.config.revision,
        activeProfile: profile ? { id: profile.id, name: profile.name } : null,
        brightness: state.config.device.brightness,
        ledColor: state.config.device.ledColor,
      });
    }),
  );

  server.registerTool(
    "list_profiles",
    {
      title: "List M18 profiles",
      description: "List profile IDs, names, active state, and the current configuration revision.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    withErrors(async () => {
      const state = await client.getState();
      return toolResult({
        revision: state.config.revision,
        profiles: state.config.profiles.map((profile) => ({
          id: profile.id,
          name: profile.name,
          active: profile.id === state.config.activeProfileId,
        })),
      });
    }),
  );

  server.registerTool(
    "get_profile",
    {
      title: "Read an M18 profile",
      description: "Read all 18 key assignments for a profile, or the active profile when profile_id is omitted.",
      inputSchema: z.object({ profile_id: safeIdSchema.optional() }),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    withErrors(async ({ profile_id }) => {
      const state = await client.getState();
      const id = profile_id || state.config.activeProfileId;
      const profile = state.config.profiles.find((entry) => entry.id === id);
      if (!profile) throw new Error("Profile was not found");
      return toolResult({ revision: state.config.revision, profile });
    }),
  );

  server.registerTool(
    "create_profile",
    {
      title: "Create an M18 profile",
      description: "Create a blank profile or duplicate an existing profile and make it active.",
      inputSchema: z.object({
        name: z.string().min(1).max(64),
        duplicate_from: safeIdSchema.optional(),
        expected_revision: z.number().int().nonnegative(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    withErrors(async ({ name, duplicate_from, expected_revision }) =>
      toolResult(
        await client.request("/api/profiles", {
          method: "POST",
          body: { name, duplicateFrom: duplicate_from || null, expectedRevision: expected_revision },
        }),
      ),
    ),
  );

  server.registerTool(
    "delete_profile",
    {
      title: "Delete an M18 profile",
      description: "Delete one profile. This cannot delete the last profile and requires explicit confirmation.",
      inputSchema: z.object({
        profile_id: safeIdSchema,
        expected_revision: z.number().int().nonnegative(),
        confirm: z.literal(true).describe("True only after the user explicitly requested deletion"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    withErrors(async ({ profile_id, expected_revision }) =>
      toolResult(
        await client.request(`/api/profiles/${encodeURIComponent(profile_id)}`, {
          method: "DELETE",
          body: { expectedRevision: expected_revision },
        }),
      ),
    ),
  );

  server.registerTool(
    "set_active_profile",
    {
      title: "Activate an M18 profile",
      description:
        "Make a profile active and optionally render it on the connected M18. Rendering defaults off and partial apply failures are reported without hiding the saved activation.",
      inputSchema: z.object({
        profile_id: safeIdSchema,
        apply: z.boolean().default(false),
        expected_revision: z.number().int().nonnegative(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    withErrors(async ({ profile_id, apply, expected_revision }) =>
      toolResult(
        await client.request("/api/profiles/active", {
          method: "POST",
          body: { profileId: profile_id, apply, expectedRevision: expected_revision },
        }),
      ),
    ),
  );

  server.registerTool(
    "update_key",
    {
      title: "Configure an M18 key",
      description:
        "Update one key in stored configuration. This does not execute the action or change hardware artwork until apply_profile is called.",
      inputSchema: updateKeySchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    withErrors(async ({ profile_id, key, expected_revision, label, color, asset_id, action }) => {
      const state = await client.getState();
      const config = structuredClone(state.config);
      const profile = config.profiles.find((entry) => entry.id === profile_id);
      if (!profile) throw new Error("Profile was not found");
      const target = profile.keys[key - 1];
      if (label !== undefined) target.label = label;
      if (color !== undefined) target.color = color;
      if (asset_id !== undefined) target.assetId = asset_id;
      if (action !== undefined) target.action = action;
      return toolResult(await client.replaceConfig(config, expected_revision));
    }),
  );

  server.registerTool(
    "set_brightness",
    {
      title: "Set M18 brightness",
      description: "Persist LCD brightness from 0 to 100 and send it to the connected dock.",
      inputSchema: z.object({
        value: z.number().int().min(0).max(100),
        expected_revision: z.number().int().nonnegative(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    withErrors(async ({ value, expected_revision }) =>
      toolResult(
        await client.request("/api/device/brightness", {
          method: "POST",
          body: { value, expectedRevision: expected_revision },
        }),
      ),
    ),
  );

  server.registerTool(
    "set_led_color",
    {
      title: "Set M18 LED color",
      description: "Persist one RGB color for all 24 M18 LEDs and send it to the connected dock.",
      inputSchema: z.object({
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        expected_revision: z.number().int().nonnegative(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    withErrors(async ({ color, expected_revision }) =>
      toolResult(
        await client.request("/api/device/led", {
          method: "POST",
          body: { color, expectedRevision: expected_revision },
        }),
      ),
    ),
  );

  server.registerTool(
    "apply_profile",
    {
      title: "Render the active profile",
      description:
        "Render the inspected active profile's 15 LCD key images, brightness, and LED color. The operation stops if its profile or revision changed.",
      inputSchema: z.object({
        profile_id: safeIdSchema,
        expected_revision: z.number().int().nonnegative(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    withErrors(async ({ profile_id, expected_revision }) =>
      toolResult(
        await client.request("/api/device/apply", {
          method: "POST",
          body: { profileId: profile_id, expectedRevision: expected_revision },
        }),
      ),
    ),
  );

  server.registerTool(
    "trigger_button",
    {
      title: "Trigger a configured M18 button",
      description:
        "Execute one configured key action. Command and URL actions require confirm=true after explicit user approval.",
      inputSchema: z.object({
        profile_id: safeIdSchema,
        key: z.number().int().min(1).max(KEY_COUNT),
        expected_revision: z.number().int().nonnegative(),
        expected_action: actionSchema,
        confirm: z.boolean().default(false),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    withErrors(async ({ profile_id, key, expected_revision, expected_action, confirm }) =>
      toolResult(
        await client.request("/api/actions/trigger", {
          method: "POST",
          body: {
            profileId: profile_id,
            key,
            expectedRevision: expected_revision,
            expectedAction: expected_action,
            confirm,
            source: "mcp",
          },
        }),
      ),
    ),
  );

  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void serveStdio(() => createM18McpServer());
  console.error("VSD M18 MCP server is listening on stdio");
}
