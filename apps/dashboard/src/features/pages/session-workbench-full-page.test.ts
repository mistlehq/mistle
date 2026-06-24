import { describe, expect, it } from "vitest";

import type { ChatEntry } from "../chat/chat-types.js";
import {
  resolveSessionEntryPreparationState,
  shouldAutoStartWorkbenchTurn,
} from "./session-workbench-full-page.js";

type AutoStartInput = Parameters<typeof shouldAutoStartWorkbenchTurn>[0];
type EntryPreparationInput = Parameters<typeof resolveSessionEntryPreparationState>[0];

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
    isInitialConversationHydrated: true,
    isStartingTurn: false,
    startedTurnKeys: new Set(),
    transitionState: "stable_chat",
    ...overrides,
  };
}

function createReadyEntryPreparationInput(
  overrides: Partial<EntryPreparationInput> = {},
): EntryPreparationInput {
  return {
    activeConversationId: "thread_designer",
    activeTurnState: "idle",
    autoStartTurn: undefined,
    bootstrapPhaseStatus: "ready",
    chatEntries: [],
    isInitialConversationHydrated: true,
    startupState: null,
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

  it("does not start an auto turn before the initial conversation is hydrated", () => {
    expect(
      shouldAutoStartWorkbenchTurn(
        createReadyAutoStartInput({
          isInitialConversationHydrated: false,
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

describe("resolveSessionEntryPreparationState", () => {
  it("keeps showing sandbox startup state before conversation readiness checks", () => {
    expect(
      resolveSessionEntryPreparationState(
        createReadyEntryPreparationInput({
          startupState: "preparing_sandbox",
        }),
      ),
    ).toBe("preparing_sandbox");
  });

  it("prepares the conversation while no active runtime conversation is available", () => {
    expect(
      resolveSessionEntryPreparationState(
        createReadyEntryPreparationInput({
          activeConversationId: null,
        }),
      ),
    ).toBe("preparing_conversation");
  });

  it("loads the conversation until the active transcript has hydrated", () => {
    expect(
      resolveSessionEntryPreparationState(
        createReadyEntryPreparationInput({
          isInitialConversationHydrated: false,
        }),
      ),
    ).toBe("loading_conversation");
  });

  it("prepares the conversation while runtime composer bootstrap is still running", () => {
    expect(
      resolveSessionEntryPreparationState(
        createReadyEntryPreparationInput({
          bootstrapPhaseStatus: "bootstrapping",
        }),
      ),
    ).toBe("preparing_conversation");
  });

  it("keeps the entry surface visible while an auto-start turn is ready but not visible", () => {
    expect(
      resolveSessionEntryPreparationState(
        createReadyEntryPreparationInput({
          autoStartTurn: {
            key: "designer:dsn_test:initial-prompt",
            prompt: "Configure a Slack and WhatsApp agent.",
          },
        }),
      ),
    ).toBe("starting_first_turn");
  });

  it("shows chat once the auto-start prompt is represented by a user message", () => {
    expect(
      resolveSessionEntryPreparationState(
        createReadyEntryPreparationInput({
          autoStartTurn: {
            key: "designer:dsn_test:initial-prompt",
            prompt: "Configure a Slack and WhatsApp agent.",
          },
          chatEntries: [createUserEntry("Configure a Slack and WhatsApp agent.")],
        }),
      ),
    ).toBeNull();
  });

  it("shows chat when bootstrap fails so the composer can present the blocking error", () => {
    expect(
      resolveSessionEntryPreparationState(
        createReadyEntryPreparationInput({
          bootstrapPhaseStatus: "failed",
        }),
      ),
    ).toBeNull();
  });
});
