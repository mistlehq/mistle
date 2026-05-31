import { SandboxInstanceStatuses, type SandboxInstanceStatus } from "./statuses.js";

export const SandboxLifecycleEvents = Object.freeze({
  PROVIDER_START_REQUESTED: "provider_start_requested",
  PROVIDER_START_ACCEPTED: "provider_start_accepted",
  PROVIDER_RUNTIME_INITIALIZATION_STARTED: "provider_runtime_initialization_started",
  RUNTIME_READY: "runtime_ready",
  BOOTSTRAP_DEGRADED: "bootstrap_degraded",
  BOOTSTRAP_RECOVERED: "bootstrap_recovered",
  BOOTSTRAP_DETACHED: "bootstrap_detached",
  BOOTSTRAP_REATTACHED_NOT_READY: "bootstrap_reattached_not_ready",
  BOOTSTRAP_REATTACHED_READY: "bootstrap_reattached_ready",
  STOP_REQUESTED: "stop_requested",
  PROVIDER_STOPPED: "provider_stopped",
  FAILURE_RECORDED: "failure_recorded",
});

export type SandboxLifecycleEvent =
  (typeof SandboxLifecycleEvents)[keyof typeof SandboxLifecycleEvents];

export type SandboxLifecycleTransitionResult =
  | {
      kind: "transition";
      from: SandboxInstanceStatus;
      to: SandboxInstanceStatus;
    }
  | {
      kind: "unchanged";
      status: SandboxInstanceStatus;
    }
  | {
      kind: "invalid";
      status: SandboxInstanceStatus;
      event: SandboxLifecycleEvent;
      reason: string;
    };

export function transitionSandboxLifecycle(input: {
  status: SandboxInstanceStatus;
  event: SandboxLifecycleEvent;
}): SandboxLifecycleTransitionResult {
  switch (input.event) {
    case SandboxLifecycleEvents.PROVIDER_START_REQUESTED:
      return transitionFrom(input, {
        from: [
          SandboxInstanceStatuses.PENDING,
          SandboxInstanceStatuses.STOPPED,
          SandboxInstanceStatuses.FAILED,
        ],
        to: SandboxInstanceStatuses.STARTING,
        idempotent: [SandboxInstanceStatuses.STARTING],
      });
    case SandboxLifecycleEvents.PROVIDER_START_ACCEPTED:
      return transitionFrom(input, {
        from: [SandboxInstanceStatuses.STARTING],
        to: SandboxInstanceStatuses.STARTED,
        idempotent: [SandboxInstanceStatuses.STARTED],
      });
    case SandboxLifecycleEvents.PROVIDER_RUNTIME_INITIALIZATION_STARTED:
      return transitionFrom(input, {
        from: [SandboxInstanceStatuses.STARTED],
        to: SandboxInstanceStatuses.INITIALIZING,
        idempotent: [SandboxInstanceStatuses.INITIALIZING],
      });
    case SandboxLifecycleEvents.RUNTIME_READY:
      return transitionFrom(input, {
        from: [SandboxInstanceStatuses.INITIALIZING],
        to: SandboxInstanceStatuses.RUNNING,
        idempotent: [SandboxInstanceStatuses.RUNNING],
      });
    case SandboxLifecycleEvents.BOOTSTRAP_DEGRADED:
      return transitionFrom(input, {
        from: [SandboxInstanceStatuses.RUNNING],
        to: SandboxInstanceStatuses.DEGRADED,
        idempotent: [SandboxInstanceStatuses.DEGRADED],
      });
    case SandboxLifecycleEvents.BOOTSTRAP_RECOVERED:
      return transitionFrom(input, {
        from: [SandboxInstanceStatuses.DEGRADED],
        to: SandboxInstanceStatuses.RUNNING,
        idempotent: [SandboxInstanceStatuses.RUNNING],
      });
    case SandboxLifecycleEvents.BOOTSTRAP_DETACHED:
      return transitionFrom(input, {
        from: [SandboxInstanceStatuses.RUNNING, SandboxInstanceStatuses.DEGRADED],
        to: SandboxInstanceStatuses.RECONNECTING,
        idempotent: [SandboxInstanceStatuses.RECONNECTING],
      });
    case SandboxLifecycleEvents.BOOTSTRAP_REATTACHED_NOT_READY:
      return transitionFrom(input, {
        from: [SandboxInstanceStatuses.RECONNECTING],
        to: SandboxInstanceStatuses.INITIALIZING,
        idempotent: [SandboxInstanceStatuses.INITIALIZING],
      });
    case SandboxLifecycleEvents.BOOTSTRAP_REATTACHED_READY:
      return transitionFrom(input, {
        from: [SandboxInstanceStatuses.RECONNECTING],
        to: SandboxInstanceStatuses.RUNNING,
        idempotent: [SandboxInstanceStatuses.RUNNING],
      });
    case SandboxLifecycleEvents.STOP_REQUESTED:
      return transitionFrom(input, {
        from: [
          SandboxInstanceStatuses.STARTING,
          SandboxInstanceStatuses.STARTED,
          SandboxInstanceStatuses.RUNNING,
          SandboxInstanceStatuses.DEGRADED,
          SandboxInstanceStatuses.RECONNECTING,
          SandboxInstanceStatuses.INITIALIZING,
        ],
        to: SandboxInstanceStatuses.STOPPING,
        idempotent: [SandboxInstanceStatuses.STOPPING],
      });
    case SandboxLifecycleEvents.PROVIDER_STOPPED:
      return transitionFrom(input, {
        from: [SandboxInstanceStatuses.STOPPING],
        to: SandboxInstanceStatuses.STOPPED,
        idempotent: [SandboxInstanceStatuses.STOPPED],
      });
    case SandboxLifecycleEvents.FAILURE_RECORDED:
      return transitionFrom(input, {
        from: [
          SandboxInstanceStatuses.PENDING,
          SandboxInstanceStatuses.STARTING,
          SandboxInstanceStatuses.STARTED,
          SandboxInstanceStatuses.INITIALIZING,
          SandboxInstanceStatuses.RUNNING,
          SandboxInstanceStatuses.DEGRADED,
          SandboxInstanceStatuses.RECONNECTING,
          SandboxInstanceStatuses.STOPPING,
          SandboxInstanceStatuses.STOPPED,
        ],
        to: SandboxInstanceStatuses.FAILED,
        idempotent: [SandboxInstanceStatuses.FAILED],
      });
  }
}

function transitionFrom(
  input: {
    status: SandboxInstanceStatus;
    event: SandboxLifecycleEvent;
  },
  rule: {
    from: readonly SandboxInstanceStatus[];
    to: SandboxInstanceStatus;
    idempotent?: readonly SandboxInstanceStatus[];
  },
): SandboxLifecycleTransitionResult {
  if (rule.from.includes(input.status)) {
    if (input.status === rule.to) {
      return {
        kind: "unchanged",
        status: input.status,
      };
    }

    return {
      kind: "transition",
      from: input.status,
      to: rule.to,
    };
  }

  if (rule.idempotent?.includes(input.status) === true) {
    return {
      kind: "unchanged",
      status: input.status,
    };
  }

  return {
    kind: "invalid",
    status: input.status,
    event: input.event,
    reason: `Cannot apply sandbox lifecycle event '${input.event}' while status is '${input.status}'.`,
  };
}
