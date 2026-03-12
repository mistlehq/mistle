import { describe, expect, it } from "vitest";

import {
  AutomationConversationDeliverySandboxActions,
  AutomationConversationRouteBindingActions,
  resolveAutomationConversationDeliverySandboxAction,
  resolveAutomationConversationRouteBindingAction,
} from "../../workflows/index.js";
import {
  AutomationConversationExecutionActions,
  AutomationConversationSteerRecoveryActions,
  isRecoverableLateSteerError,
  resolveAutomationConversationExecutionAction,
  resolveAutomationConversationSteerRecoveryAction,
} from "./automation-conversation-delivery.js";

describe("conversation delivery plans", () => {
  describe("resolveAutomationConversationDeliverySandboxAction", () => {
    it("starts a new sandbox when no route sandbox is persisted", () => {
      expect(
        resolveAutomationConversationDeliverySandboxAction({
          sandboxInstanceId: null,
          sandboxStatus: null,
        }),
      ).toBe(AutomationConversationDeliverySandboxActions.START_NEW);
    });

    it("reuses the persisted sandbox when it is still running", () => {
      expect(
        resolveAutomationConversationDeliverySandboxAction({
          sandboxInstanceId: "sbi_123",
          sandboxStatus: "running",
        }),
      ).toBe(AutomationConversationDeliverySandboxActions.REUSE_EXISTING);
    });

    it("fails closed when a persisted provider conversation is bound to a stopped sandbox", () => {
      expect(
        resolveAutomationConversationDeliverySandboxAction({
          sandboxInstanceId: "sbi_123",
          sandboxStatus: "stopped",
        }),
      ).toBe(AutomationConversationDeliverySandboxActions.FAIL);
    });

    it("fails closed when a pending route sandbox is no longer running", () => {
      expect(
        resolveAutomationConversationDeliverySandboxAction({
          sandboxInstanceId: "sbi_123",
          sandboxStatus: "failed",
        }),
      ).toBe(AutomationConversationDeliverySandboxActions.FAIL);
    });
  });

  describe("resolveAutomationConversationRouteBindingAction", () => {
    it("creates a route when none exists yet", () => {
      expect(
        resolveAutomationConversationRouteBindingAction({
          routeId: null,
          routeSandboxInstanceId: null,
          providerConversationId: null,
          ensuredSandboxInstanceId: "sbi_123",
        }),
      ).toBe(AutomationConversationRouteBindingActions.CREATE_ROUTE);
    });

    it("activates a pending route only when the same sandbox is reused", () => {
      expect(
        resolveAutomationConversationRouteBindingAction({
          routeId: "cvr_123",
          routeSandboxInstanceId: "sbi_123",
          providerConversationId: null,
          ensuredSandboxInstanceId: "sbi_123",
        }),
      ).toBe(AutomationConversationRouteBindingActions.ACTIVATE_PENDING_ROUTE);
    });

    it("reuses an active route when the same sandbox and provider conversation are present", () => {
      expect(
        resolveAutomationConversationRouteBindingAction({
          routeId: "cvr_123",
          routeSandboxInstanceId: "sbi_123",
          providerConversationId: "thread_123",
          ensuredSandboxInstanceId: "sbi_123",
        }),
      ).toBe(AutomationConversationRouteBindingActions.REUSE_ACTIVE_ROUTE);
    });

    it("fails when delivery attempts to continue a route on a different sandbox", () => {
      expect(
        resolveAutomationConversationRouteBindingAction({
          routeId: "cvr_123",
          routeSandboxInstanceId: "sbi_123",
          providerConversationId: null,
          ensuredSandboxInstanceId: "sbi_456",
        }),
      ).toBe(AutomationConversationRouteBindingActions.FAIL_SANDBOX_MISMATCH);
    });
  });

  describe("resolveAutomationConversationExecutionAction", () => {
    it("fails when the provider conversation is missing", () => {
      expect(
        resolveAutomationConversationExecutionAction({
          inspectAutomationConversation: {
            exists: false,
            status: "idle",
            activeExecutionId: null,
          },
          providerExecutionId: null,
          adapter: {},
        }),
      ).toBe(AutomationConversationExecutionActions.FAIL_MISSING_CONVERSATION);
    });

    it("fails when the provider conversation is in an error state", () => {
      expect(
        resolveAutomationConversationExecutionAction({
          inspectAutomationConversation: {
            exists: true,
            status: "error",
            activeExecutionId: null,
          },
          providerExecutionId: null,
          adapter: {},
        }),
      ).toBe(AutomationConversationExecutionActions.FAIL_PROVIDER_ERROR);
    });

    it("starts a new execution when the provider conversation is idle", () => {
      expect(
        resolveAutomationConversationExecutionAction({
          inspectAutomationConversation: {
            exists: true,
            status: "idle",
            activeExecutionId: null,
          },
          providerExecutionId: null,
          adapter: {},
        }),
      ).toBe(AutomationConversationExecutionActions.START);
    });

    it("fails when an active provider conversation has no persisted execution id", () => {
      expect(
        resolveAutomationConversationExecutionAction({
          inspectAutomationConversation: {
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
      ).toBe(AutomationConversationExecutionActions.FAIL_MISSING_EXECUTION);
    });

    it("fails when steering is unsupported for an active provider conversation", () => {
      expect(
        resolveAutomationConversationExecutionAction({
          inspectAutomationConversation: {
            exists: true,
            status: "active",
            activeExecutionId: null,
          },
          providerExecutionId: "turn_123",
          adapter: {},
        }),
      ).toBe(AutomationConversationExecutionActions.FAIL_STEER_NOT_SUPPORTED);
    });

    it("steers the active execution when provider state is consistent", () => {
      expect(
        resolveAutomationConversationExecutionAction({
          inspectAutomationConversation: {
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
      ).toBe(AutomationConversationExecutionActions.STEER);
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

  describe("resolveAutomationConversationSteerRecoveryAction", () => {
    it("starts a new execution only when the conversation is now idle", () => {
      expect(
        resolveAutomationConversationSteerRecoveryAction({
          inspectAutomationConversation: {
            exists: true,
            status: "idle",
            activeExecutionId: null,
          },
        }),
      ).toBe(AutomationConversationSteerRecoveryActions.START);
    });

    it("fails when the conversation disappeared after the steer race", () => {
      expect(
        resolveAutomationConversationSteerRecoveryAction({
          inspectAutomationConversation: {
            exists: false,
            status: "idle",
            activeExecutionId: null,
          },
        }),
      ).toBe(AutomationConversationSteerRecoveryActions.FAIL_MISSING_CONVERSATION);
    });

    it("fails when the conversation is still active after the steer race", () => {
      expect(
        resolveAutomationConversationSteerRecoveryAction({
          inspectAutomationConversation: {
            exists: true,
            status: "active",
            activeExecutionId: "turn_123",
          },
        }),
      ).toBe(AutomationConversationSteerRecoveryActions.FAIL_STILL_ACTIVE);
    });

    it("fails when the conversation is in an error state after the steer race", () => {
      expect(
        resolveAutomationConversationSteerRecoveryAction({
          inspectAutomationConversation: {
            exists: true,
            status: "error",
            activeExecutionId: null,
          },
        }),
      ).toBe(AutomationConversationSteerRecoveryActions.FAIL_PROVIDER_ERROR);
    });
  });
});
