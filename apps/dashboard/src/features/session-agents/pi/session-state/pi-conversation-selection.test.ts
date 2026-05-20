import type { PiConversationSummary } from "@mistle/integrations-definitions/agent-runtimes/pi/client";
import { describe, expect, it } from "vitest";

import {
  resolveOriginalPiConversationId,
  resolvePiConversationDirectory,
  resolvePiConversationSelection,
} from "./use-pi-session-state.js";

function createConversation(input: {
  createdAt: string | null;
  sessionFile: string;
}): PiConversationSummary {
  return {
    createdAt: input.createdAt,
    cwd: "/workspace/repo",
    sessionFile: input.sessionFile,
    title: null,
    updatedAt: 1,
  };
}

describe("resolvePiConversationSelection", () => {
  it("resumes the explicit target Pi conversation first", () => {
    expect(
      resolvePiConversationSelection({
        targetSessionFile: "/root/.pi/agent/sessions/target.jsonl",
        recentProviderConversationId: "/root/.pi/agent/sessions/recent.jsonl",
      }),
    ).toEqual({
      kind: "resume",
      sessionFile: "/root/.pi/agent/sessions/target.jsonl",
    });
  });

  it("resumes the recent Pi conversation when no explicit target is supplied", () => {
    expect(
      resolvePiConversationSelection({
        targetSessionFile: null,
        recentProviderConversationId: "/root/.pi/agent/sessions/recent.jsonl",
      }),
    ).toEqual({
      kind: "resume",
      sessionFile: "/root/.pi/agent/sessions/recent.jsonl",
    });
  });

  it("creates a Pi conversation only when there is no explicit or recent target", () => {
    expect(
      resolvePiConversationSelection({
        targetSessionFile: null,
        recentProviderConversationId: null,
      }),
    ).toEqual({
      kind: "create",
    });
  });
});

describe("resolveOriginalPiConversationId", () => {
  it("uses the explicit provider conversation id when one is supplied", () => {
    expect(
      resolveOriginalPiConversationId({
        explicitProviderConversationId: "/root/.pi/agent/sessions/trigger.jsonl",
        hasMoreSandboxConversations: true,
        sandboxConversations: [
          createConversation({
            createdAt: "2026-05-19T00:00:00.000Z",
            sessionFile: "/root/.pi/agent/sessions/earliest.jsonl",
          }),
        ],
      }),
    ).toBe("/root/.pi/agent/sessions/trigger.jsonl");
  });

  it("uses the earliest created listed Pi conversation when the sandbox list is complete", () => {
    expect(
      resolveOriginalPiConversationId({
        explicitProviderConversationId: null,
        hasMoreSandboxConversations: false,
        sandboxConversations: [
          createConversation({
            createdAt: "2026-05-20T00:00:00.000Z",
            sessionFile: "/root/.pi/agent/sessions/newer.jsonl",
          }),
          createConversation({
            createdAt: "2026-05-19T00:00:00.000Z",
            sessionFile: "/root/.pi/agent/sessions/older.jsonl",
          }),
        ],
      }),
    ).toBe("/root/.pi/agent/sessions/older.jsonl");
  });

  it("omits the original Pi conversation when the sandbox list is incomplete", () => {
    expect(
      resolveOriginalPiConversationId({
        explicitProviderConversationId: null,
        hasMoreSandboxConversations: true,
        sandboxConversations: [
          createConversation({
            createdAt: "2026-05-19T00:00:00.000Z",
            sessionFile: "/root/.pi/agent/sessions/visible.jsonl",
          }),
        ],
      }),
    ).toBeNull();
  });
});

describe("resolvePiConversationDirectory", () => {
  it("uses the preferred directory when one is provided", () => {
    expect(
      resolvePiConversationDirectory({
        conversations: [
          createConversation({
            createdAt: "2026-05-19T00:00:00.000Z",
            sessionFile: "/root/.pi/agent/sessions/current.jsonl",
          }),
        ],
        preferredDirectory: "/workspace/selected",
        sessionFile: "/root/.pi/agent/sessions/current.jsonl",
      }),
    ).toBe("/workspace/selected");
  });

  it("derives the directory from listed Pi conversation metadata when no preferred directory is available", () => {
    expect(
      resolvePiConversationDirectory({
        conversations: [
          createConversation({
            createdAt: "2026-05-19T00:00:00.000Z",
            sessionFile: "/root/.pi/agent/sessions/current.jsonl",
          }),
        ],
        preferredDirectory: null,
        sessionFile: "/root/.pi/agent/sessions/current.jsonl",
      }),
    ).toBe("/workspace/repo");
  });
});
