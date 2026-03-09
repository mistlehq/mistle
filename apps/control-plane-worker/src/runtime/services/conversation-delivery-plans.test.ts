import { describe, expect, it } from "vitest";

import {
  ConversationDeliverySandboxActions,
  ConversationExecutionActions,
  resolveConversationDeliverySandboxAction,
  resolveConversationExecutionAction,
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
});
