import { SandboxInstanceStatuses, type SandboxInstanceStatus } from "./statuses.js";

export const SandboxDeliveryDispositions = Object.freeze({
  DELIVER: "deliver",
  WAIT: "wait",
  RESUME: "resume",
  RECOVER: "recover",
  NON_DELIVERABLE: "non_deliverable",
});

export type SandboxDeliveryDisposition =
  (typeof SandboxDeliveryDispositions)[keyof typeof SandboxDeliveryDispositions];

export function getSandboxDeliveryDisposition(
  status: SandboxInstanceStatus,
): SandboxDeliveryDisposition {
  switch (status) {
    case SandboxInstanceStatuses.RUNNING:
      return SandboxDeliveryDispositions.DELIVER;
    case SandboxInstanceStatuses.PENDING:
    case SandboxInstanceStatuses.STARTING:
    case SandboxInstanceStatuses.STARTED:
    case SandboxInstanceStatuses.INITIALIZING:
    case SandboxInstanceStatuses.RECONNECTING:
      return SandboxDeliveryDispositions.WAIT;
    case SandboxInstanceStatuses.STOPPED:
      return SandboxDeliveryDispositions.RESUME;
    case SandboxInstanceStatuses.FAILED:
      return SandboxDeliveryDispositions.RECOVER;
    case SandboxInstanceStatuses.STOPPING:
      return SandboxDeliveryDispositions.NON_DELIVERABLE;
  }
}

export function isSandboxBootstrapTokenExchangeEligible(status: SandboxInstanceStatus): boolean {
  switch (status) {
    case SandboxInstanceStatuses.STARTING:
    case SandboxInstanceStatuses.STARTED:
    case SandboxInstanceStatuses.INITIALIZING:
    case SandboxInstanceStatuses.RUNNING:
    case SandboxInstanceStatuses.RECONNECTING:
      return true;
    case SandboxInstanceStatuses.PENDING:
    case SandboxInstanceStatuses.STOPPING:
    case SandboxInstanceStatuses.STOPPED:
    case SandboxInstanceStatuses.FAILED:
      return false;
  }
}

export function isSandboxUserStopEligible(status: SandboxInstanceStatus): boolean {
  switch (status) {
    case SandboxInstanceStatuses.RUNNING:
    case SandboxInstanceStatuses.RECONNECTING:
      return true;
    case SandboxInstanceStatuses.PENDING:
    case SandboxInstanceStatuses.STARTING:
    case SandboxInstanceStatuses.STARTED:
    case SandboxInstanceStatuses.INITIALIZING:
    case SandboxInstanceStatuses.STOPPING:
    case SandboxInstanceStatuses.STOPPED:
    case SandboxInstanceStatuses.FAILED:
      return false;
  }
}

export function isSandboxDisconnectReconciliationCandidate(status: SandboxInstanceStatus): boolean {
  switch (status) {
    case SandboxInstanceStatuses.STARTING:
    case SandboxInstanceStatuses.STARTED:
    case SandboxInstanceStatuses.INITIALIZING:
    case SandboxInstanceStatuses.RUNNING:
    case SandboxInstanceStatuses.RECONNECTING:
      return true;
    case SandboxInstanceStatuses.PENDING:
    case SandboxInstanceStatuses.STOPPING:
    case SandboxInstanceStatuses.STOPPED:
    case SandboxInstanceStatuses.FAILED:
      return false;
  }
}

export function getSandboxEffectiveStatus(input: {
  persistedStatus: SandboxInstanceStatus;
  runtimeReady: boolean;
  bootstrapAttached: boolean;
}): SandboxInstanceStatus {
  switch (input.persistedStatus) {
    case SandboxInstanceStatuses.PENDING:
    case SandboxInstanceStatuses.FAILED:
    case SandboxInstanceStatuses.RECONNECTING:
    case SandboxInstanceStatuses.STOPPING:
      return input.persistedStatus;
    case SandboxInstanceStatuses.RUNNING:
      if (input.runtimeReady) {
        return SandboxInstanceStatuses.RUNNING;
      }
      if (input.bootstrapAttached) {
        return SandboxInstanceStatuses.INITIALIZING;
      }
      return SandboxInstanceStatuses.RECONNECTING;
    case SandboxInstanceStatuses.STOPPED:
      if (input.runtimeReady) {
        return SandboxInstanceStatuses.RUNNING;
      }
      if (input.bootstrapAttached) {
        return SandboxInstanceStatuses.INITIALIZING;
      }
      return SandboxInstanceStatuses.STOPPED;
    case SandboxInstanceStatuses.STARTING:
    case SandboxInstanceStatuses.STARTED:
    case SandboxInstanceStatuses.INITIALIZING:
      if (input.runtimeReady) {
        return SandboxInstanceStatuses.RUNNING;
      }
      if (input.bootstrapAttached) {
        return SandboxInstanceStatuses.INITIALIZING;
      }
      return input.persistedStatus;
  }
}
