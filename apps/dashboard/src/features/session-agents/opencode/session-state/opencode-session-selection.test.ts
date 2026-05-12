import type { OpenCodeSessionSummary } from "@mistle/integrations-definitions/agent-runtimes/opencode/client";
import { describe, expect, it } from "vitest";

import { resolveOpenCodeSessionSelection } from "./use-opencode-session-state.js";

function createSession(id: string): OpenCodeSessionSummary {
  return {
    directory: "/workspace/repo",
    id,
    projectID: "project",
    slug: id,
    time: {
      created: 1,
      updated: 2,
    },
    title: id,
    version: "1.14.41",
  };
}

describe("resolveOpenCodeSessionSelection", () => {
  it("uses the requested target session when one is provided", () => {
    expect(
      resolveOpenCodeSessionSelection({
        listedSessions: [createSession("ses_recent")],
        targetSessionId: "ses_target",
      }),
    ).toEqual({
      kind: "resume",
      sessionId: "ses_target",
    });
  });

  it("resumes the first listed session when no target session is provided", () => {
    expect(
      resolveOpenCodeSessionSelection({
        listedSessions: [createSession("ses_recent"), createSession("ses_old")],
        targetSessionId: null,
      }),
    ).toEqual({
      kind: "resume",
      sessionId: "ses_recent",
    });
  });

  it("creates a new session when no target or existing session is available", () => {
    expect(
      resolveOpenCodeSessionSelection({
        listedSessions: [],
        targetSessionId: null,
      }),
    ).toEqual({
      kind: "create",
    });
  });
});
