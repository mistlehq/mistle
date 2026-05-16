import { describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import {
  applyPatchedSessionTitleToCache,
  resolveCachedSessionStatus,
} from "./session-header-title-model.js";
import {
  sandboxInstancesListQueryKey,
  sandboxInstanceStatusQueryKey,
} from "./sessions-query-keys.js";
import type { SandboxInstancesListResult } from "./sessions-types.js";

describe("session header title model", () => {
  it("reads cached session status from the status query", () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(sandboxInstanceStatusQueryKey("sbi_123"), {
      title: "Existing title",
    });

    expect(resolveCachedSessionStatus(queryClient, "sbi_123")).toEqual({
      title: "Existing title",
    });
  });

  it("applies a patched title onto an existing cached status record", () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(sandboxInstanceStatusQueryKey("sbi_123"), {
      title: null,
      status: "running",
      connectable: true,
    });

    applyPatchedSessionTitleToCache(queryClient, {
      id: "sbi_123",
      title: "Renamed session",
      updatedAt: "2026-04-27T01:00:00.000Z",
    });

    expect(queryClient.getQueryData(sandboxInstanceStatusQueryKey("sbi_123"))).toEqual({
      title: "Renamed session",
      status: "running",
      connectable: true,
    });
  });

  it("creates a minimal cached status record when none exists yet", () => {
    const queryClient = createTestQueryClient();

    applyPatchedSessionTitleToCache(queryClient, {
      id: "sbi_123",
      title: "Renamed session",
      updatedAt: "2026-04-27T01:00:00.000Z",
    });

    expect(queryClient.getQueryData(sandboxInstanceStatusQueryKey("sbi_123"))).toEqual({
      title: "Renamed session",
    });
  });

  it("updates the matching row in cached session lists", () => {
    const queryClient = createTestQueryClient();
    const listQueryKey = sandboxInstancesListQueryKey({
      limit: 25,
      after: null,
      before: null,
      search: "",
      owner: "anyone",
      startedFrom: "any",
      triggerId: null,
    });
    queryClient.setQueryData<SandboxInstancesListResult>(listQueryKey, {
      items: [
        buildSandboxInstanceListItem({ id: "sbi_123", title: null }),
        buildSandboxInstanceListItem({ id: "sbi_other", title: "Other session" }),
      ],
      nextPage: null,
      previousPage: null,
      totalResults: 2,
    });

    applyPatchedSessionTitleToCache(queryClient, {
      id: "sbi_123",
      title: "Generated session title",
      updatedAt: "2026-04-27T01:00:00.000Z",
    });

    expect(queryClient.getQueryData<SandboxInstancesListResult>(listQueryKey)?.items).toEqual([
      buildSandboxInstanceListItem({
        id: "sbi_123",
        title: "Generated session title",
        updatedAt: "2026-04-27T01:00:00.000Z",
      }),
      buildSandboxInstanceListItem({ id: "sbi_other", title: "Other session" }),
    ]);
  });
});

function buildSandboxInstanceListItem(input: {
  id: string;
  title: string | null;
  updatedAt?: string;
}): SandboxInstancesListResult["items"][number] {
  return {
    id: input.id,
    title: input.title,
    sandboxProfileId: "sbp_profile",
    sandboxProfileDisplayName: "Profile",
    sandboxProfileVersion: 1,
    status: "running",
    startedBy: {
      kind: "user",
      id: "user_123",
      name: "Mistle User",
    },
    source: "dashboard",
    createdAt: "2026-04-27T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-04-27T00:00:00.000Z",
    failureCode: null,
    failureMessage: null,
  };
}
