import { describe, expect, it } from "vitest";

import { resolvePiConversationSelection } from "./use-pi-session-state.js";

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
