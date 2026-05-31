import { describe, expect, it } from "vitest";

import {
  SandboxInstanceStatuses,
  SandboxLifecycleEvents,
  transitionSandboxLifecycle,
} from "./index.js";

describe("transitionSandboxLifecycle", () => {
  it("models the provider start path through runtime readiness", () => {
    expect(
      transitionSandboxLifecycle({
        status: SandboxInstanceStatuses.PENDING,
        event: SandboxLifecycleEvents.PROVIDER_START_REQUESTED,
      }),
    ).toEqual({
      kind: "transition",
      from: SandboxInstanceStatuses.PENDING,
      to: SandboxInstanceStatuses.STARTING,
    });

    expect(
      transitionSandboxLifecycle({
        status: SandboxInstanceStatuses.STARTING,
        event: SandboxLifecycleEvents.PROVIDER_START_ACCEPTED,
      }),
    ).toEqual({
      kind: "transition",
      from: SandboxInstanceStatuses.STARTING,
      to: SandboxInstanceStatuses.STARTED,
    });

    expect(
      transitionSandboxLifecycle({
        status: SandboxInstanceStatuses.STARTED,
        event: SandboxLifecycleEvents.PROVIDER_RUNTIME_INITIALIZATION_STARTED,
      }),
    ).toEqual({
      kind: "transition",
      from: SandboxInstanceStatuses.STARTED,
      to: SandboxInstanceStatuses.INITIALIZING,
    });

    expect(
      transitionSandboxLifecycle({
        status: SandboxInstanceStatuses.INITIALIZING,
        event: SandboxLifecycleEvents.RUNTIME_READY,
      }),
    ).toEqual({
      kind: "transition",
      from: SandboxInstanceStatuses.INITIALIZING,
      to: SandboxInstanceStatuses.RUNNING,
    });
  });

  it("models reconnect detach and both reattach paths", () => {
    expect(
      transitionSandboxLifecycle({
        status: SandboxInstanceStatuses.RUNNING,
        event: SandboxLifecycleEvents.BOOTSTRAP_DETACHED,
      }),
    ).toEqual({
      kind: "transition",
      from: SandboxInstanceStatuses.RUNNING,
      to: SandboxInstanceStatuses.RECONNECTING,
    });

    expect(
      transitionSandboxLifecycle({
        status: SandboxInstanceStatuses.RECONNECTING,
        event: SandboxLifecycleEvents.BOOTSTRAP_REATTACHED_READY,
      }),
    ).toEqual({
      kind: "transition",
      from: SandboxInstanceStatuses.RECONNECTING,
      to: SandboxInstanceStatuses.RUNNING,
    });

    expect(
      transitionSandboxLifecycle({
        status: SandboxInstanceStatuses.RECONNECTING,
        event: SandboxLifecycleEvents.BOOTSTRAP_REATTACHED_NOT_READY,
      }),
    ).toEqual({
      kind: "transition",
      from: SandboxInstanceStatuses.RECONNECTING,
      to: SandboxInstanceStatuses.INITIALIZING,
    });
  });

  it("models degraded bootstrap health transitions", () => {
    expect(
      transitionSandboxLifecycle({
        status: SandboxInstanceStatuses.RUNNING,
        event: SandboxLifecycleEvents.BOOTSTRAP_DEGRADED,
      }),
    ).toEqual({
      kind: "transition",
      from: SandboxInstanceStatuses.RUNNING,
      to: SandboxInstanceStatuses.DEGRADED,
    });

    expect(
      transitionSandboxLifecycle({
        status: SandboxInstanceStatuses.DEGRADED,
        event: SandboxLifecycleEvents.BOOTSTRAP_RECOVERED,
      }),
    ).toEqual({
      kind: "transition",
      from: SandboxInstanceStatuses.DEGRADED,
      to: SandboxInstanceStatuses.RUNNING,
    });

    expect(
      transitionSandboxLifecycle({
        status: SandboxInstanceStatuses.DEGRADED,
        event: SandboxLifecycleEvents.BOOTSTRAP_DETACHED,
      }),
    ).toEqual({
      kind: "transition",
      from: SandboxInstanceStatuses.DEGRADED,
      to: SandboxInstanceStatuses.RECONNECTING,
    });
  });

  it("models stop and failure transitions", () => {
    expect(
      transitionSandboxLifecycle({
        status: SandboxInstanceStatuses.RECONNECTING,
        event: SandboxLifecycleEvents.STOP_REQUESTED,
      }),
    ).toEqual({
      kind: "transition",
      from: SandboxInstanceStatuses.RECONNECTING,
      to: SandboxInstanceStatuses.STOPPING,
    });

    expect(
      transitionSandboxLifecycle({
        status: SandboxInstanceStatuses.DEGRADED,
        event: SandboxLifecycleEvents.STOP_REQUESTED,
      }),
    ).toEqual({
      kind: "transition",
      from: SandboxInstanceStatuses.DEGRADED,
      to: SandboxInstanceStatuses.STOPPING,
    });

    expect(
      transitionSandboxLifecycle({
        status: SandboxInstanceStatuses.STOPPING,
        event: SandboxLifecycleEvents.PROVIDER_STOPPED,
      }),
    ).toEqual({
      kind: "transition",
      from: SandboxInstanceStatuses.STOPPING,
      to: SandboxInstanceStatuses.STOPPED,
    });

    expect(
      transitionSandboxLifecycle({
        status: SandboxInstanceStatuses.STOPPING,
        event: SandboxLifecycleEvents.FAILURE_RECORDED,
      }),
    ).toEqual({
      kind: "transition",
      from: SandboxInstanceStatuses.STOPPING,
      to: SandboxInstanceStatuses.FAILED,
    });
  });

  it("keeps explicitly idempotent events unchanged", () => {
    expect(
      transitionSandboxLifecycle({
        status: SandboxInstanceStatuses.STARTED,
        event: SandboxLifecycleEvents.PROVIDER_START_ACCEPTED,
      }),
    ).toEqual({
      kind: "unchanged",
      status: SandboxInstanceStatuses.STARTED,
    });

    expect(
      transitionSandboxLifecycle({
        status: SandboxInstanceStatuses.INITIALIZING,
        event: SandboxLifecycleEvents.PROVIDER_RUNTIME_INITIALIZATION_STARTED,
      }),
    ).toEqual({
      kind: "unchanged",
      status: SandboxInstanceStatuses.INITIALIZING,
    });

    expect(
      transitionSandboxLifecycle({
        status: SandboxInstanceStatuses.RUNNING,
        event: SandboxLifecycleEvents.RUNTIME_READY,
      }),
    ).toEqual({
      kind: "unchanged",
      status: SandboxInstanceStatuses.RUNNING,
    });

    expect(
      transitionSandboxLifecycle({
        status: SandboxInstanceStatuses.RECONNECTING,
        event: SandboxLifecycleEvents.BOOTSTRAP_DETACHED,
      }),
    ).toEqual({
      kind: "unchanged",
      status: SandboxInstanceStatuses.RECONNECTING,
    });

    expect(
      transitionSandboxLifecycle({
        status: SandboxInstanceStatuses.DEGRADED,
        event: SandboxLifecycleEvents.BOOTSTRAP_DEGRADED,
      }),
    ).toEqual({
      kind: "unchanged",
      status: SandboxInstanceStatuses.DEGRADED,
    });

    expect(
      transitionSandboxLifecycle({
        status: SandboxInstanceStatuses.RUNNING,
        event: SandboxLifecycleEvents.BOOTSTRAP_RECOVERED,
      }),
    ).toEqual({
      kind: "unchanged",
      status: SandboxInstanceStatuses.RUNNING,
    });

    expect(
      transitionSandboxLifecycle({
        status: SandboxInstanceStatuses.INITIALIZING,
        event: SandboxLifecycleEvents.BOOTSTRAP_REATTACHED_NOT_READY,
      }),
    ).toEqual({
      kind: "unchanged",
      status: SandboxInstanceStatuses.INITIALIZING,
    });

    expect(
      transitionSandboxLifecycle({
        status: SandboxInstanceStatuses.STOPPING,
        event: SandboxLifecycleEvents.STOP_REQUESTED,
      }),
    ).toEqual({
      kind: "unchanged",
      status: SandboxInstanceStatuses.STOPPING,
    });

    expect(
      transitionSandboxLifecycle({
        status: SandboxInstanceStatuses.STOPPED,
        event: SandboxLifecycleEvents.PROVIDER_STOPPED,
      }),
    ).toEqual({
      kind: "unchanged",
      status: SandboxInstanceStatuses.STOPPED,
    });

    expect(
      transitionSandboxLifecycle({
        status: SandboxInstanceStatuses.STOPPING,
        event: SandboxLifecycleEvents.STOP_REQUESTED,
      }),
    ).toEqual({
      kind: "unchanged",
      status: SandboxInstanceStatuses.STOPPING,
    });

    expect(
      transitionSandboxLifecycle({
        status: SandboxInstanceStatuses.STARTING,
        event: SandboxLifecycleEvents.PROVIDER_START_REQUESTED,
      }),
    ).toEqual({
      kind: "unchanged",
      status: SandboxInstanceStatuses.STARTING,
    });

    expect(
      transitionSandboxLifecycle({
        status: SandboxInstanceStatuses.STARTED,
        event: SandboxLifecycleEvents.PROVIDER_START_ACCEPTED,
      }),
    ).toEqual({
      kind: "unchanged",
      status: SandboxInstanceStatuses.STARTED,
    });

    expect(
      transitionSandboxLifecycle({
        status: SandboxInstanceStatuses.INITIALIZING,
        event: SandboxLifecycleEvents.PROVIDER_RUNTIME_INITIALIZATION_STARTED,
      }),
    ).toEqual({
      kind: "unchanged",
      status: SandboxInstanceStatuses.INITIALIZING,
    });
  });

  it("rejects unsupported event and status combinations", () => {
    expect(
      transitionSandboxLifecycle({
        status: SandboxInstanceStatuses.PENDING,
        event: SandboxLifecycleEvents.RUNTIME_READY,
      }),
    ).toEqual({
      kind: "invalid",
      status: SandboxInstanceStatuses.PENDING,
      event: SandboxLifecycleEvents.RUNTIME_READY,
      reason: "Cannot apply sandbox lifecycle event 'runtime_ready' while status is 'pending'.",
    });
  });
});
