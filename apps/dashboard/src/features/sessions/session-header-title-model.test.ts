import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import {
  applyPatchedSessionTitleToCache,
  resolveCachedSessionStatus,
} from "./session-header-title-model.js";
import { sandboxInstanceStatusQueryKey } from "./sessions-query-keys.js";

describe("session header title model", () => {
  it("reads cached session status from the status query", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(sandboxInstanceStatusQueryKey("sbi_123"), {
      title: "Existing title",
    });

    expect(resolveCachedSessionStatus(queryClient, "sbi_123")).toEqual({
      title: "Existing title",
    });
  });

  it("applies a patched title onto an existing cached status record", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(sandboxInstanceStatusQueryKey("sbi_123"), {
      title: null,
      status: "running",
      connectable: true,
    });

    applyPatchedSessionTitleToCache(queryClient, {
      id: "sbi_123",
      title: "Renamed session",
    });

    expect(queryClient.getQueryData(sandboxInstanceStatusQueryKey("sbi_123"))).toEqual({
      title: "Renamed session",
      status: "running",
      connectable: true,
    });
  });

  it("creates a minimal cached status record when none exists yet", () => {
    const queryClient = new QueryClient();

    applyPatchedSessionTitleToCache(queryClient, {
      id: "sbi_123",
      title: "Renamed session",
    });

    expect(queryClient.getQueryData(sandboxInstanceStatusQueryKey("sbi_123"))).toEqual({
      title: "Renamed session",
    });
  });
});
