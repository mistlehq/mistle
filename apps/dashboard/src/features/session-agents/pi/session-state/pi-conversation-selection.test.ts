import type { PiConversationSummary } from "@mistle/integrations-definitions/agent-runtimes/pi/client";
import { describe, expect, it } from "vitest";

import {
  resolveListedPiConversationId,
  resolveOriginalPiConversationId,
  resolvePiConversationDirectory,
  resolvePiConversationSelection,
} from "./use-pi-session-state.js";

function createConversation(input: {
  createdAt: string | null;
  id: string;
  sessionFile: string;
}): PiConversationSummary {
  return {
    createdAt: input.createdAt,
    cwd: "/workspace/repo",
    id: input.id,
    sessionFile: input.sessionFile,
    title: null,
    updatedAt: 1,
  };
}

describe("resolvePiConversationSelection", () => {
  it("resumes the explicit target Pi conversation first", () => {
    expect(
      resolvePiConversationSelection({
        targetConversationId: "target",
        recentProviderConversationId: "recent",
      }),
    ).toEqual({
      kind: "resume",
      providerConversationId: "target",
    });
  });

  it("resumes the recent Pi conversation when no explicit target is supplied", () => {
    expect(
      resolvePiConversationSelection({
        targetConversationId: null,
        recentProviderConversationId: "recent",
      }),
    ).toEqual({
      kind: "resume",
      providerConversationId: "recent",
    });
  });

  it("creates a Pi conversation only when there is no explicit or recent target", () => {
    expect(
      resolvePiConversationSelection({
        targetConversationId: null,
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
        explicitProviderConversationId: "trigger",
        hasMoreSandboxConversations: true,
        sandboxConversations: [
          createConversation({
            createdAt: "2026-05-19T00:00:00.000Z",
            id: "earliest",
            sessionFile: "/root/.pi/agent/sessions/earliest.jsonl",
          }),
        ],
      }),
    ).toBe("trigger");
  });

  it("uses the earliest created listed Pi conversation when the sandbox list is complete", () => {
    expect(
      resolveOriginalPiConversationId({
        explicitProviderConversationId: null,
        hasMoreSandboxConversations: false,
        sandboxConversations: [
          createConversation({
            createdAt: "2026-05-20T00:00:00.000Z",
            id: "newer",
            sessionFile: "/root/.pi/agent/sessions/newer.jsonl",
          }),
          createConversation({
            createdAt: "2026-05-19T00:00:00.000Z",
            id: "older",
            sessionFile: "/root/.pi/agent/sessions/older.jsonl",
          }),
        ],
      }),
    ).toBe("older");
  });

  it("omits the original Pi conversation when the sandbox list is incomplete", () => {
    expect(
      resolveOriginalPiConversationId({
        explicitProviderConversationId: null,
        hasMoreSandboxConversations: true,
        sandboxConversations: [
          createConversation({
            createdAt: "2026-05-19T00:00:00.000Z",
            id: "visible",
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
            id: "current",
            sessionFile: "/root/.pi/agent/sessions/current.jsonl",
          }),
        ],
        conversationId: "current",
        preferredDirectory: "/workspace/selected",
      }),
    ).toBe("/workspace/selected");
  });

  it("derives the directory from listed Pi conversation metadata when no preferred directory is available", () => {
    expect(
      resolvePiConversationDirectory({
        conversations: [
          createConversation({
            createdAt: "2026-05-19T00:00:00.000Z",
            id: "current",
            sessionFile: "/root/.pi/agent/sessions/current.jsonl",
          }),
        ],
        conversationId: "current",
        preferredDirectory: null,
      }),
    ).toBe("/workspace/repo");
  });
});

describe("resolveListedPiConversationId", () => {
  it("uses the listed provider id for the active Pi session file", () => {
    expect(
      resolveListedPiConversationId({
        conversations: [
          createConversation({
            createdAt: "2026-05-19T00:00:00.000Z",
            id: "persisted-header-id",
            sessionFile: "/root/.pi/agent/sessions/current.jsonl",
          }),
        ],
        fallbackConversationId: "runtime-state-id",
        sessionFile: "/root/.pi/agent/sessions/current.jsonl",
      }),
    ).toBe("persisted-header-id");
  });

  it("keeps the runtime provider id while the Pi session file is not listed yet", () => {
    expect(
      resolveListedPiConversationId({
        conversations: [],
        fallbackConversationId: "runtime-state-id",
        sessionFile: "/root/.pi/agent/sessions/current.jsonl",
      }),
    ).toBe("runtime-state-id");
  });
});
