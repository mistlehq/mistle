import { describe, expect, it } from "vitest";

import {
  resolveClaudeCodeSessionSelection,
  resolveClaudeCodeResumeDirectory,
  resolveOriginalClaudeCodeSessionId,
  type ClaudeCodeSessionNavigatorSummary,
} from "./use-claude-code-session-state.js";

function createSession(input: {
  createdAt: number | null;
  id: string;
  updatedAt?: number | null;
}): ClaudeCodeSessionNavigatorSummary {
  return {
    id: input.id,
    title: input.id,
    cwd: "/workspace",
    createdAt: input.createdAt,
    updatedAt: input.updatedAt ?? input.createdAt,
  };
}

describe("resolveClaudeCodeSessionSelection", () => {
  it("resumes the explicit target session before considering listed sessions", () => {
    expect(
      resolveClaudeCodeSessionSelection({
        targetSessionId: "ses_target",
        listedSessions: [createSession({ id: "ses_recent", createdAt: 200 })],
      }),
    ).toEqual({
      kind: "resume",
      sessionId: "ses_target",
    });
  });

  it("resumes the first listed session when no explicit target was requested", () => {
    expect(
      resolveClaudeCodeSessionSelection({
        targetSessionId: null,
        listedSessions: [
          createSession({ id: "ses_recent", createdAt: 200 }),
          createSession({ id: "ses_old", createdAt: 100 }),
        ],
      }),
    ).toEqual({
      kind: "resume",
      sessionId: "ses_recent",
    });
  });

  it("creates a session when no explicit target or listed session exists", () => {
    expect(
      resolveClaudeCodeSessionSelection({
        targetSessionId: null,
        listedSessions: [],
      }),
    ).toEqual({
      kind: "create",
    });
  });
});

describe("resolveOriginalClaudeCodeSessionId", () => {
  it("uses the explicit provider session id as the original session", () => {
    expect(
      resolveOriginalClaudeCodeSessionId({
        explicitProviderSessionId: "ses_provider",
        hasMoreSandboxSessions: false,
        sandboxSessions: [createSession({ id: "ses_old", createdAt: 100 })],
      }),
    ).toBe("ses_provider");
  });

  it("does not infer an original session from an incomplete sandbox session page", () => {
    expect(
      resolveOriginalClaudeCodeSessionId({
        explicitProviderSessionId: null,
        hasMoreSandboxSessions: true,
        sandboxSessions: [createSession({ id: "ses_old", createdAt: 100 })],
      }),
    ).toBeNull();
  });

  it("uses the oldest listed sandbox session as the original session", () => {
    expect(
      resolveOriginalClaudeCodeSessionId({
        explicitProviderSessionId: null,
        hasMoreSandboxSessions: false,
        sandboxSessions: [
          createSession({ id: "ses_recent", createdAt: 300 }),
          createSession({ id: "ses_old", createdAt: 100 }),
          createSession({ id: "ses_middle", createdAt: 200 }),
        ],
      }),
    ).toBe("ses_old");
  });
});

describe("resolveClaudeCodeResumeDirectory", () => {
  it("defaults to the active directory when no resume input was provided", () => {
    expect(
      resolveClaudeCodeResumeDirectory({
        activeDirectory: "/workspace/repo",
      }),
    ).toBe("/workspace/repo");
  });

  it("omits cwd when the resume input came from a cwd-less listed session", () => {
    expect(
      resolveClaudeCodeResumeDirectory({
        activeDirectory: "/workspace/repo",
        resumeInput: {},
      }),
    ).toBeNull();
  });

  it("omits cwd when a listed session uses the empty cwd sentinel", () => {
    expect(
      resolveClaudeCodeResumeDirectory({
        activeDirectory: "/workspace/repo",
        resumeInput: { directory: "" },
      }),
    ).toBeNull();
  });
});
