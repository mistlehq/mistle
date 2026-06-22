import { describe, expect, it } from "vitest";

import type { ChatEntry } from "../chat/chat-types.js";
import { shouldAutoStartWorkbenchTurn } from "./session-workbench-full-page.js";

function createUserEntry(text: string): ChatEntry {
  return {
    id: "user-entry",
    kind: "user-message",
    status: "completed",
    text,
    turnId: "user-turn",
  };
}

describe("shouldAutoStartWorkbenchTurn", () => {
  it("starts an auto turn when the chat is ready and the prompt is not already visible", () => {
    expect(
      shouldAutoStartWorkbenchTurn({
        activeConversationId: "thread_designer",
        activeTurnState: "idle",
        autoStartTurn: {
          key: "designer:dsn_test:initial-prompt",
          prompt: "Configure a Slack and WhatsApp agent.",
        },
        chatEntries: [],
        initialEntryStartupState: null,
        isStartingTurn: false,
        startedTurnKeys: new Set(),
        transitionState: "stable_chat",
      }),
    ).toBe(true);
  });

  it("does not start an auto turn when the prompt is already represented by a user message", () => {
    expect(
      shouldAutoStartWorkbenchTurn({
        activeConversationId: "thread_designer",
        activeTurnState: "idle",
        autoStartTurn: {
          key: "designer:dsn_test:initial-prompt",
          prompt: "Configure a Slack and WhatsApp agent.",
        },
        chatEntries: [createUserEntry("Configure a Slack and WhatsApp agent.")],
        initialEntryStartupState: null,
        isStartingTurn: false,
        startedTurnKeys: new Set(),
        transitionState: "stable_chat",
      }),
    ).toBe(false);
  });

  it("does not start an auto turn before the chat panel is ready", () => {
    expect(
      shouldAutoStartWorkbenchTurn({
        activeConversationId: "thread_designer",
        activeTurnState: "idle",
        autoStartTurn: {
          key: "designer:dsn_test:initial-prompt",
          prompt: "Configure a Slack and WhatsApp agent.",
        },
        chatEntries: [],
        initialEntryStartupState: null,
        isStartingTurn: false,
        startedTurnKeys: new Set(),
        transitionState: "restoring_chat",
      }),
    ).toBe(false);
  });

  it("does not start the same auto turn more than once", () => {
    expect(
      shouldAutoStartWorkbenchTurn({
        activeConversationId: "thread_designer",
        activeTurnState: "idle",
        autoStartTurn: {
          key: "designer:dsn_test:initial-prompt",
          prompt: "Configure a Slack and WhatsApp agent.",
        },
        chatEntries: [],
        initialEntryStartupState: null,
        isStartingTurn: false,
        startedTurnKeys: new Set(["designer:dsn_test:initial-prompt"]),
        transitionState: "stable_chat",
      }),
    ).toBe(false);
  });

  it("does not start an auto turn before a runtime conversation is active", () => {
    expect(
      shouldAutoStartWorkbenchTurn({
        activeConversationId: null,
        activeTurnState: "idle",
        autoStartTurn: {
          key: "designer:dsn_test:initial-prompt",
          prompt: "Configure a Slack and WhatsApp agent.",
        },
        chatEntries: [],
        initialEntryStartupState: null,
        isStartingTurn: false,
        startedTurnKeys: new Set(),
        transitionState: "stable_chat",
      }),
    ).toBe(false);
  });
});
