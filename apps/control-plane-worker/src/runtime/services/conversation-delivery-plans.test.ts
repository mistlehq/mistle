import { describe, expect, it } from "vitest";

import {
  ConversationDeliverySandboxActions,
  ConversationExecutionActions,
  ConversationSteerRecoveryActions,
  isRecoverableLateSteerError,
  resolveConversationDeliverySandboxAction,
  resolveConversationExecutionAction,
  resolveConversationSteerRecoveryAction,
} from "./conversation-delivery-plans.js";

describe("conversation delivery plans", () => {
  describe("resolveConversationDeliverySandboxAction", () => {
    it("starts a new sandbox when no route sandbox is persisted", () => {
      expect(
        resolveConversationDeliverySandboxAction({
          sandboxInstanceId: null,
          providerConversationId: null,
          sandboxStatus: null,
        }),
      ).toBe(ConversationDeliverySandboxActions.START_NEW);
    });

    it("reuses the persisted sandbox when it is still running", () => {
      expect(
        resolveConversationDeliverySandboxAction({
          sandboxInstanceId: "sbi_123",
          providerConversationId: "thread_123",
          sandboxStatus: "running",
        }),
      ).toBe(ConversationDeliverySandboxActions.REUSE_EXISTING);
    });

    it("fails closed when a persisted provider conversation is bound to a stopped sandbox", () => {
      expect(
        resolveConversationDeliverySandboxAction({
          sandboxInstanceId: "sbi_123",
          providerConversationId: "thread_123",
          sandboxStatus: "stopped",
        }),
      ).toBe(ConversationDeliverySandboxActions.FAIL);
    });

    it("starts a new sandbox when a pre-activation route sandbox is no longer running", () => {
      expect(
        resolveConversationDeliverySandboxAction({
          sandboxInstanceId: "sbi_123",
          providerConversationId: null,
          sandboxStatus: "failed",
        }),
      ).toBe(ConversationDeliverySandboxActions.START_NEW);
    });
  });

  describe("resolveConversationExecutionAction", () => {
    it("fails when the provider conversation is missing", () => {
      expect(
        resolveConversationExecutionAction({
          inspectConversation: {
            exists: false,
            status: "idle",
            activeExecutionId: null,
          },
          providerExecutionId: null,
          adapter: {},
        }),
      ).toBe(ConversationExecutionActions.FAIL_MISSING_CONVERSATION);
    });

    it("fails when the provider conversation is in an error state", () => {
      expect(
        resolveConversationExecutionAction({
          inspectConversation: {
            exists: true,
            status: "error",
            activeExecutionId: null,
          },
          providerExecutionId: null,
          adapter: {},
        }),
      ).toBe(ConversationExecutionActions.FAIL_PROVIDER_ERROR);
    });

    it("starts a new execution when the provider conversation is idle", () => {
      expect(
        resolveConversationExecutionAction({
          inspectConversation: {
            exists: true,
            status: "idle",
            activeExecutionId: null,
          },
          providerExecutionId: null,
          adapter: {},
        }),
      ).toBe(ConversationExecutionActions.START);
    });

    it("fails when an active provider conversation has no persisted execution id", () => {
      expect(
        resolveConversationExecutionAction({
          inspectConversation: {
            exists: true,
            status: "active",
            activeExecutionId: null,
          },
          providerExecutionId: null,
          adapter: {
            steerExecution: async () => ({
              providerExecutionId: "turn_123",
            }),
          },
        }),
      ).toBe(ConversationExecutionActions.FAIL_MISSING_EXECUTION);
    });

    it("fails when steering is unsupported for an active provider conversation", () => {
      expect(
        resolveConversationExecutionAction({
          inspectConversation: {
            exists: true,
            status: "active",
            activeExecutionId: null,
          },
          providerExecutionId: "turn_123",
          adapter: {},
        }),
      ).toBe(ConversationExecutionActions.FAIL_STEER_NOT_SUPPORTED);
    });

    it("steers the active execution when provider state is consistent", () => {
      expect(
        resolveConversationExecutionAction({
          inspectConversation: {
            exists: true,
            status: "active",
            activeExecutionId: null,
          },
          providerExecutionId: "turn_123",
          adapter: {
            steerExecution: async () => ({
              providerExecutionId: "turn_123",
            }),
          },
        }),
      ).toBe(ConversationExecutionActions.STEER);
    });
  });

  describe("isRecoverableLateSteerError", () => {
    it("recognizes the no-active-turn steer race as recoverable", () => {
      expect(
        isRecoverableLateSteerError({
          error: {
            code: "provider_execution_missing",
            message:
              "Codex app-server request 'turn/steer' failed (-32600): no active turn to steer",
          },
        }),
      ).toBe(true);
    });

    it("does not recover expected-turn mismatches", () => {
      expect(
        isRecoverableLateSteerError({
          error: {
            code: "provider_execution_missing",
            message:
              "Codex app-server request 'turn/steer' failed (-32600): expected active turn id `turn_expected` but found `turn_actual`",
          },
        }),
      ).toBe(false);
    });

    it("does not recover unrelated provider errors", () => {
      expect(
        isRecoverableLateSteerError({
          error: {
            code: "provider_steer_execution_failed",
            message: "Codex steer execution failed.",
          },
        }),
      ).toBe(false);
    });
  });

  describe("resolveConversationSteerRecoveryAction", () => {
    it("starts a new execution only when the conversation is now idle", () => {
      expect(
        resolveConversationSteerRecoveryAction({
          inspectConversation: {
            exists: true,
            status: "idle",
            activeExecutionId: null,
          },
        }),
      ).toBe(ConversationSteerRecoveryActions.START);
    });

    it("fails when the conversation disappeared after the steer race", () => {
      expect(
        resolveConversationSteerRecoveryAction({
          inspectConversation: {
            exists: false,
            status: "idle",
            activeExecutionId: null,
          },
        }),
      ).toBe(ConversationSteerRecoveryActions.FAIL_MISSING_CONVERSATION);
    });

    it("fails when the conversation is still active after the steer race", () => {
      expect(
        resolveConversationSteerRecoveryAction({
          inspectConversation: {
            exists: true,
            status: "active",
            activeExecutionId: "turn_123",
          },
        }),
      ).toBe(ConversationSteerRecoveryActions.FAIL_STILL_ACTIVE);
    });

    it("fails when the conversation is in an error state after the steer race", () => {
      expect(
        resolveConversationSteerRecoveryAction({
          inspectConversation: {
            exists: true,
            status: "error",
            activeExecutionId: null,
          },
        }),
      ).toBe(ConversationSteerRecoveryActions.FAIL_PROVIDER_ERROR);
    });
  });
});
