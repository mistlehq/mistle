import { describe, expect, it } from "vitest";

import {
  TriggerConversationDeliverySandboxActions,
  TriggerConversationRouteBindingActions,
  resolveTriggerConversationDeliverySandboxAction,
  resolveTriggerConversationRouteBindingAction,
} from "./conversation-delivery-planning.js";
import {
  TriggerConversationExecutionActions,
  TriggerConversationSteerRecoveryActions,
  isRecoverableLateSteerError,
  resolveTriggerConversationExecutionAction,
  resolveTriggerConversationSteerRecoveryAction,
} from "./trigger-conversation-delivery.js";

describe("conversation delivery plans", () => {
  describe("resolveTriggerConversationDeliverySandboxAction", () => {
    it("starts a new sandbox when no route sandbox is persisted", () => {
      expect(
        resolveTriggerConversationDeliverySandboxAction({
          sandboxInstanceId: null,
          sandboxStatus: null,
        }),
      ).toBe(TriggerConversationDeliverySandboxActions.START_NEW);
    });

    it("reuses the persisted sandbox when it is already running", () => {
      expect(
        resolveTriggerConversationDeliverySandboxAction({
          sandboxInstanceId: "sbi_123",
          sandboxStatus: "running",
        }),
      ).toBe(TriggerConversationDeliverySandboxActions.REUSE_EXISTING);
    });

    it("reuses the persisted sandbox when it is still starting", () => {
      expect(
        resolveTriggerConversationDeliverySandboxAction({
          sandboxInstanceId: "sbi_123",
          sandboxStatus: "starting",
        }),
      ).toBe(TriggerConversationDeliverySandboxActions.REUSE_EXISTING);
    });

    it("reuses the persisted sandbox when provisioning is still pending", () => {
      expect(
        resolveTriggerConversationDeliverySandboxAction({
          sandboxInstanceId: "sbi_123",
          sandboxStatus: "pending",
        }),
      ).toBe(TriggerConversationDeliverySandboxActions.REUSE_EXISTING);
    });

    it("reuses the persisted sandbox when it is stopped but resumable", () => {
      expect(
        resolveTriggerConversationDeliverySandboxAction({
          sandboxInstanceId: "sbi_123",
          sandboxStatus: "stopped",
        }),
      ).toBe(TriggerConversationDeliverySandboxActions.REUSE_EXISTING);
    });

    it("recovers with a replacement sandbox when a persisted sandbox has failed", () => {
      expect(
        resolveTriggerConversationDeliverySandboxAction({
          sandboxInstanceId: "sbi_123",
          sandboxStatus: "failed",
        }),
      ).toBe(TriggerConversationDeliverySandboxActions.RECOVER_FAILED);
    });
  });

  describe("resolveTriggerConversationRouteBindingAction", () => {
    it("creates a route when none exists yet", () => {
      expect(
        resolveTriggerConversationRouteBindingAction({
          routeId: null,
          routeSandboxInstanceId: null,
          providerConversationId: null,
          ensuredSandboxInstanceId: "sbi_123",
        }),
      ).toBe(TriggerConversationRouteBindingActions.CREATE_ROUTE);
    });

    it("activates a pending route only when the same sandbox is reused", () => {
      expect(
        resolveTriggerConversationRouteBindingAction({
          routeId: "cvr_123",
          routeSandboxInstanceId: "sbi_123",
          providerConversationId: null,
          ensuredSandboxInstanceId: "sbi_123",
        }),
      ).toBe(TriggerConversationRouteBindingActions.ACTIVATE_PENDING_ROUTE);
    });

    it("reuses an active route when the same sandbox and provider conversation are present", () => {
      expect(
        resolveTriggerConversationRouteBindingAction({
          routeId: "cvr_123",
          routeSandboxInstanceId: "sbi_123",
          providerConversationId: "thread_123",
          ensuredSandboxInstanceId: "sbi_123",
        }),
      ).toBe(TriggerConversationRouteBindingActions.REUSE_ACTIVE_ROUTE);
    });

    it("fails when delivery attempts to continue a route on a different sandbox", () => {
      expect(
        resolveTriggerConversationRouteBindingAction({
          routeId: "cvr_123",
          routeSandboxInstanceId: "sbi_123",
          providerConversationId: null,
          ensuredSandboxInstanceId: "sbi_456",
        }),
      ).toBe(TriggerConversationRouteBindingActions.FAIL_SANDBOX_MISMATCH);
    });
  });

  describe("resolveTriggerConversationExecutionAction", () => {
    it("fails when the provider conversation is missing", () => {
      expect(
        resolveTriggerConversationExecutionAction({
          inspectTriggerConversation: {
            exists: false,
            status: "idle",
            activeExecutionId: null,
          },
          providerExecutionId: null,
          adapter: {
            steerExecution: async () => ({
              providerExecutionId: "turn_123",
            }),
          },
        }),
      ).toBe(TriggerConversationExecutionActions.FAIL_MISSING_CONVERSATION);
    });

    it("fails when the provider conversation is in an error state", () => {
      expect(
        resolveTriggerConversationExecutionAction({
          inspectTriggerConversation: {
            exists: true,
            status: "error",
            activeExecutionId: null,
          },
          providerExecutionId: null,
          adapter: {
            steerExecution: async () => ({
              providerExecutionId: "turn_123",
            }),
          },
        }),
      ).toBe(TriggerConversationExecutionActions.FAIL_PROVIDER_ERROR);
    });

    it("fails closed when the provider conversation still is not loaded", () => {
      expect(
        resolveTriggerConversationExecutionAction({
          inspectTriggerConversation: {
            exists: true,
            status: "not_loaded",
            activeExecutionId: null,
          },
          providerExecutionId: null,
          adapter: {
            steerExecution: async () => ({
              providerExecutionId: "turn_123",
            }),
          },
        }),
      ).toBe(TriggerConversationExecutionActions.FAIL_NOT_LOADED);
    });

    it("starts a new execution when the provider conversation is idle", () => {
      expect(
        resolveTriggerConversationExecutionAction({
          inspectTriggerConversation: {
            exists: true,
            status: "idle",
            activeExecutionId: null,
          },
          providerExecutionId: null,
          adapter: {
            steerExecution: async () => ({
              providerExecutionId: "turn_123",
            }),
          },
        }),
      ).toBe(TriggerConversationExecutionActions.START);
    });

    it("fails when an active provider conversation has no persisted execution id", () => {
      expect(
        resolveTriggerConversationExecutionAction({
          inspectTriggerConversation: {
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
      ).toBe(TriggerConversationExecutionActions.FAIL_MISSING_EXECUTION);
    });

    it("steers the active execution when provider state is consistent", () => {
      expect(
        resolveTriggerConversationExecutionAction({
          inspectTriggerConversation: {
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
      ).toBe(TriggerConversationExecutionActions.STEER);
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

  describe("resolveTriggerConversationSteerRecoveryAction", () => {
    it("starts a new execution only when the conversation is now idle", () => {
      expect(
        resolveTriggerConversationSteerRecoveryAction({
          inspectTriggerConversation: {
            exists: true,
            status: "idle",
            activeExecutionId: null,
          },
        }),
      ).toBe(TriggerConversationSteerRecoveryActions.START);
    });

    it("fails when the conversation disappeared after the steer race", () => {
      expect(
        resolveTriggerConversationSteerRecoveryAction({
          inspectTriggerConversation: {
            exists: false,
            status: "idle",
            activeExecutionId: null,
          },
        }),
      ).toBe(TriggerConversationSteerRecoveryActions.FAIL_MISSING_CONVERSATION);
    });

    it("fails when the conversation is still active after the steer race", () => {
      expect(
        resolveTriggerConversationSteerRecoveryAction({
          inspectTriggerConversation: {
            exists: true,
            status: "active",
            activeExecutionId: "turn_123",
          },
        }),
      ).toBe(TriggerConversationSteerRecoveryActions.FAIL_STILL_ACTIVE);
    });

    it("fails closed when the conversation becomes not loaded after the steer race", () => {
      expect(
        resolveTriggerConversationSteerRecoveryAction({
          inspectTriggerConversation: {
            exists: true,
            status: "not_loaded",
            activeExecutionId: null,
          },
        }),
      ).toBe(TriggerConversationSteerRecoveryActions.FAIL_NOT_LOADED);
    });

    it("fails when the conversation is in an error state after the steer race", () => {
      expect(
        resolveTriggerConversationSteerRecoveryAction({
          inspectTriggerConversation: {
            exists: true,
            status: "error",
            activeExecutionId: null,
          },
        }),
      ).toBe(TriggerConversationSteerRecoveryActions.FAIL_PROVIDER_ERROR);
    });
  });
});
