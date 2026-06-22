import { describe, expect, it } from "vitest";

import type { ChatEntry } from "../chat/chat-types.js";
import { shouldAutoStartWorkbenchTurn } from "./session-workbench-full-page.js";

type AutoStartInput = Parameters<typeof shouldAutoStartWorkbenchTurn>[0];

function createUserEntry(text: string): ChatEntry {
  return {
    id: "user-entry",
    kind: "user-message",
    status: "completed",
    text,
    turnId: "user-turn",
  };
}

function createReadyAutoStartInput(overrides: Partial<AutoStartInput> = {}): AutoStartInput {
  return {
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
    ...overrides,
  };
}

describe("shouldAutoStartWorkbenchTurn", () => {
  it("starts an auto turn when the chat is ready and the prompt is not already visible", () => {
    expect(shouldAutoStartWorkbenchTurn(createReadyAutoStartInput())).toBe(true);
  });

  it("does not start an auto turn when the prompt is already represented by a user message", () => {
    expect(
      shouldAutoStartWorkbenchTurn(
        createReadyAutoStartInput({
          chatEntries: [createUserEntry("Configure a Slack and WhatsApp agent.")],
        }),
      ),
    ).toBe(false);
  });

  it("does not start an auto turn before the chat panel is ready", () => {
    expect(
      shouldAutoStartWorkbenchTurn(
        createReadyAutoStartInput({
          transitionState: "restoring_chat",
        }),
      ),
    ).toBe(false);
  });

  it("does not start the same auto turn more than once", () => {
    expect(
      shouldAutoStartWorkbenchTurn(
        createReadyAutoStartInput({
          startedTurnKeys: new Set(["designer:dsn_test:initial-prompt"]),
        }),
      ),
    ).toBe(false);
  });

  it("does not start an auto turn before a runtime conversation is active", () => {
    expect(
      shouldAutoStartWorkbenchTurn(
        createReadyAutoStartInput({
          activeConversationId: null,
        }),
      ),
    ).toBe(false);
  });

  it("does not start an auto turn while a turn is already running", () => {
    expect(
      shouldAutoStartWorkbenchTurn(
        createReadyAutoStartInput({
          activeTurnState: "running",
        }),
      ),
    ).toBe(false);
  });

  it("does not start an auto turn while a turn start is already pending", () => {
    expect(
      shouldAutoStartWorkbenchTurn(
        createReadyAutoStartInput({
          isStartingTurn: true,
        }),
      ),
    ).toBe(false);
  });

  it("does not start an auto turn while startup state is still visible", () => {
    expect(
      shouldAutoStartWorkbenchTurn(
        createReadyAutoStartInput({
          initialEntryStartupState: "preparing_sandbox",
        }),
      ),
    ).toBe(false);
  });
});
