import type { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import {
  getSandboxDeliveryDisposition,
  SandboxDeliveryDispositions,
  SandboxInstanceStatuses,
  type SandboxInstanceStatus,
} from "@mistle/sandbox-lifecycle";
import { systemSleeper } from "@mistle/time";

import {
  ProviderResourceAssociationDeliveryError,
  ProviderResourceAssociationDeliveryFailureCodes,
} from "./errors.js";

const SandboxStartTimeoutMs = 5 * 60 * 1000;
const SandboxStartPollIntervalMs = 1_000;

type SandboxWaitPhase = "startup" | "resume" | "reconnect";

function resolveSandboxWaitPhase(input: {
  status: SandboxInstanceStatus;
  didRequestResume: boolean;
}): SandboxWaitPhase {
  if (input.didRequestResume) {
    return "resume";
  }

  if (
    input.status === SandboxInstanceStatuses.DEGRADED ||
    input.status === SandboxInstanceStatuses.RECONNECTING
  ) {
    return "reconnect";
  }

  if (input.status === SandboxInstanceStatuses.STOPPED) {
    return "resume";
  }

  return "startup";
}

function resolvePollAction(input: {
  status: SandboxInstanceStatus;
  didRequestResume: boolean;
}): "mint_connection" | "fail_terminal" | "request_resume" | "wait" {
  const deliveryDisposition = getSandboxDeliveryDisposition(input.status);

  if (deliveryDisposition === SandboxDeliveryDispositions.DELIVER) {
    return "mint_connection";
  }

  if (deliveryDisposition === SandboxDeliveryDispositions.RECOVER) {
    return "fail_terminal";
  }

  if (
    deliveryDisposition === SandboxDeliveryDispositions.RESUME &&
    input.status === SandboxInstanceStatuses.STOPPED &&
    !input.didRequestResume
  ) {
    return "request_resume";
  }

  return "wait";
}

export async function acquireProviderResourceAssociationDeliveryConnection(
  ctx: {
    controlPlaneInternalClient: Pick<
      ControlPlaneInternalClient,
      "getSandboxInstance" | "mintSandboxConnectionToken" | "resumeSandboxInstanceForConnection"
    >;
  },
  input: {
    organizationId: string;
    sandboxInstanceId: string;
    deliveryId: string;
    conversationId: string;
    webhookEventId: string;
    externalDeliveryId?: string | undefined;
    timing?: {
      timeoutMs: number;
      pollIntervalMs: number;
    };
  },
): Promise<{
  instanceId: string;
  url: string;
  token: string;
  expiresAt: string;
}> {
  const timeoutMs = input.timing?.timeoutMs ?? SandboxStartTimeoutMs;
  const pollIntervalMs = input.timing?.pollIntervalMs ?? SandboxStartPollIntervalMs;
  const waitStartedAt = Date.now();
  const deadline = waitStartedAt + timeoutMs;
  let didRequestResume = false;
  let lastObservedSandboxStatus: SandboxInstanceStatus | null = null;

  while (Date.now() < deadline) {
    const sandboxInstance = await ctx.controlPlaneInternalClient.getSandboxInstance({
      organizationId: input.organizationId,
      instanceId: input.sandboxInstanceId,
    });
    lastObservedSandboxStatus = sandboxInstance.status;

    const pollAction = resolvePollAction({
      status: sandboxInstance.status,
      didRequestResume,
    });

    if (pollAction === "mint_connection") {
      return await ctx.controlPlaneInternalClient.mintSandboxConnectionToken({
        organizationId: input.organizationId,
        instanceId: input.sandboxInstanceId,
        webhookEventId: input.webhookEventId,
        deliveryTaskId: input.deliveryId,
        conversationId: input.conversationId,
        ...(input.externalDeliveryId === undefined
          ? {}
          : { externalDeliveryId: input.externalDeliveryId }),
      });
    }

    if (pollAction === "fail_terminal") {
      throw new ProviderResourceAssociationDeliveryError({
        code: ProviderResourceAssociationDeliveryFailureCodes.PROVIDER_DELIVERY_FAILED,
        message:
          sandboxInstance.failureMessage ??
          `Sandbox instance '${sandboxInstance.id}' entered terminal status '${sandboxInstance.status}' before it became ready.`,
      });
    }

    if (pollAction === "request_resume") {
      didRequestResume = true;
      await ctx.controlPlaneInternalClient.resumeSandboxInstanceForConnection({
        organizationId: input.organizationId,
        instanceId: sandboxInstance.id,
        idempotencyKey: `provider-resource-association-delivery-resume:${input.deliveryId}:${sandboxInstance.id}`,
      });
    }

    await systemSleeper.sleep(pollIntervalMs);
  }

  const waitPhase =
    lastObservedSandboxStatus === null
      ? "startup"
      : resolveSandboxWaitPhase({
          status: lastObservedSandboxStatus,
          didRequestResume,
        });
  throw new Error(
    `Sandbox instance '${input.sandboxInstanceId}' did not become ready for provider resource association delivery before the timeout elapsed during ${waitPhase}.`,
  );
}
