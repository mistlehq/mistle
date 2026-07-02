import type { CodexJsonRpcNotification } from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import type { QueryClient, QueryKey } from "@tanstack/react-query";

import { SANDBOX_PROFILES_QUERY_KEY_PREFIX } from "../../../sandbox-profiles/sandbox-profiles-query-keys.js";
import { TRIGGERS_QUERY_KEY_PREFIX } from "../../../triggers/triggers-query-keys.js";

const TriggerMutationToolNames = new Set([
  "create_trigger",
  "update_trigger",
  "delete_trigger",
  "create_trigger_webhook",
  "update_trigger_webhook",
  "delete_trigger_webhook",
  "create_trigger_schedule",
  "update_trigger_schedule",
  "delete_trigger_schedule",
]);

const SandboxProfileMutationToolNames = new Set([
  "profile_create",
  "profile_delete",
  "profile_update",
  "profile_draft_create",
  "profile_draft_discard",
  "profile_draft_setup_script_put",
  "profile_draft_update",
  "profile_maintenance_script_put",
  "profile_maintenance_script_test_start",
  "profile_setup_script_test_start",
  "profile_version_publish",
  "profile_version_refresh_snapshot",
  "profile_version_retry_snapshot",
  "save_selected_provider_resources",
]);

type DesignerProductMutationInvalidation = {
  queryKey: QueryKey;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringProperty(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function isCompletedMcpToolItem(item: Record<string, unknown>): boolean {
  return (
    readStringProperty(item, "type") === "mcpToolCall" &&
    readStringProperty(item, "status") === "completed"
  );
}

function mcpToolItemSucceeded(item: Record<string, unknown>): boolean {
  if (item["error"] !== undefined && item["error"] !== null) {
    return false;
  }

  return true;
}

export function resolveDesignerProductMutationInvalidations(
  notification: CodexJsonRpcNotification,
): readonly DesignerProductMutationInvalidation[] {
  if (notification.method !== "item/completed" || !isRecord(notification.params)) {
    return [];
  }

  const item = notification.params["item"];
  if (!isRecord(item) || !isCompletedMcpToolItem(item) || !mcpToolItemSucceeded(item)) {
    return [];
  }

  const toolName = readStringProperty(item, "tool");
  if (toolName === null) {
    return [];
  }

  if (TriggerMutationToolNames.has(toolName)) {
    return [{ queryKey: TRIGGERS_QUERY_KEY_PREFIX }];
  }

  if (SandboxProfileMutationToolNames.has(toolName)) {
    return [{ queryKey: SANDBOX_PROFILES_QUERY_KEY_PREFIX }];
  }

  return [];
}

export async function invalidateDesignerProductMutationQueries(input: {
  notification: CodexJsonRpcNotification;
  queryClient: QueryClient;
}): Promise<void> {
  const invalidations = resolveDesignerProductMutationInvalidations(input.notification);
  await Promise.all(
    invalidations.map((invalidation) =>
      input.queryClient.invalidateQueries({ queryKey: invalidation.queryKey }),
    ),
  );
}
