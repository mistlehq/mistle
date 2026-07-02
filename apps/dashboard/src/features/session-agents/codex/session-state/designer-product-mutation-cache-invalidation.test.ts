import type { CodexJsonRpcNotification } from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import { describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../../../test-support/query-client.js";
import { sandboxProfileDetailQueryKey } from "../../../sandbox-profiles/sandbox-profiles-query-keys.js";
import {
  triggerDetailQueryKey,
  triggersListQueryKey,
} from "../../../triggers/triggers-query-keys.js";
import { invalidateDesignerProductMutationQueries } from "./designer-product-mutation-cache-invalidation.js";

function completedMcpToolNotification(input: {
  error?: unknown;
  tool: string;
}): CodexJsonRpcNotification {
  return {
    method: "item/completed",
    params: {
      turnId: "turn_123",
      item: {
        type: "mcpToolCall",
        id: "tool_123",
        server: "mistle",
        tool: input.tool,
        arguments: {},
        result: {},
        ...(input.error === undefined ? {} : { error: input.error }),
        status: "completed",
      },
    },
  };
}

function readQueryInvalidation(input: {
  queryClient: ReturnType<typeof createTestQueryClient>;
  queryKey: readonly unknown[];
}): boolean {
  const query = input.queryClient.getQueryCache().find({ queryKey: input.queryKey });
  if (query === undefined) {
    throw new Error(`Expected query ${JSON.stringify(input.queryKey)} to exist.`);
  }

  return query.state.isInvalidated;
}

describe("invalidateDesignerProductMutationQueries", () => {
  it("invalidates trigger queries after successful trigger MCP mutations", async () => {
    const queryClient = createTestQueryClient({ staleTime: Number.POSITIVE_INFINITY });
    const triggerListQueryKey = triggersListQueryKey({
      limit: 25,
      after: null,
      before: null,
      sandboxProfileId: "sbp_123",
    });
    const triggerDetailKey = triggerDetailQueryKey("trg_123");
    const sandboxProfileKey = sandboxProfileDetailQueryKey("sbp_123");
    queryClient.setQueryData(triggerListQueryKey, { items: [], totalResults: 0 });
    queryClient.setQueryData(triggerDetailKey, { id: "trg_123" });
    queryClient.setQueryData(sandboxProfileKey, { id: "sbp_123" });

    await invalidateDesignerProductMutationQueries({
      notification: completedMcpToolNotification({ tool: "create_trigger" }),
      queryClient,
    });

    expect(readQueryInvalidation({ queryClient, queryKey: triggerListQueryKey })).toBe(true);
    expect(readQueryInvalidation({ queryClient, queryKey: triggerDetailKey })).toBe(true);
    expect(readQueryInvalidation({ queryClient, queryKey: sandboxProfileKey })).toBe(false);
  });

  it("invalidates sandbox profile queries after successful profile MCP mutations", async () => {
    const queryClient = createTestQueryClient({ staleTime: Number.POSITIVE_INFINITY });
    const triggerListQueryKey = triggersListQueryKey({
      limit: 25,
      after: null,
      before: null,
      sandboxProfileId: "sbp_123",
    });
    const sandboxProfileKey = sandboxProfileDetailQueryKey("sbp_123");
    queryClient.setQueryData(triggerListQueryKey, { items: [], totalResults: 0 });
    queryClient.setQueryData(sandboxProfileKey, { id: "sbp_123" });

    await invalidateDesignerProductMutationQueries({
      notification: completedMcpToolNotification({ tool: "profile_version_publish" }),
      queryClient,
    });

    expect(readQueryInvalidation({ queryClient, queryKey: sandboxProfileKey })).toBe(true);
    expect(readQueryInvalidation({ queryClient, queryKey: triggerListQueryKey })).toBe(false);
  });

  it.each([
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
  ])("invalidates sandbox profile queries after %s succeeds", async (tool) => {
    const queryClient = createTestQueryClient({ staleTime: Number.POSITIVE_INFINITY });
    const sandboxProfileKey = sandboxProfileDetailQueryKey("sbp_123");
    queryClient.setQueryData(sandboxProfileKey, { id: "sbp_123" });

    await invalidateDesignerProductMutationQueries({
      notification: completedMcpToolNotification({ tool }),
      queryClient,
    });

    expect(readQueryInvalidation({ queryClient, queryKey: sandboxProfileKey })).toBe(true);
  });

  it("does not invalidate queries for failed or read-only MCP tool results", async () => {
    const queryClient = createTestQueryClient({ staleTime: Number.POSITIVE_INFINITY });
    const triggerListQueryKey = triggersListQueryKey({
      limit: 25,
      after: null,
      before: null,
      sandboxProfileId: "sbp_123",
    });
    queryClient.setQueryData(triggerListQueryKey, { items: [], totalResults: 0 });

    await invalidateDesignerProductMutationQueries({
      notification: completedMcpToolNotification({
        tool: "create_trigger",
        error: { message: "Trigger creation failed." },
      }),
      queryClient,
    });
    await invalidateDesignerProductMutationQueries({
      notification: completedMcpToolNotification({ tool: "list_triggers" }),
      queryClient,
    });

    expect(readQueryInvalidation({ queryClient, queryKey: triggerListQueryKey })).toBe(false);
  });
});
