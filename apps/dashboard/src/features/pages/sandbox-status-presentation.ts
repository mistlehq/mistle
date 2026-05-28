import type { WorkbenchSandboxLifecycleStatus } from "./session-workbench-state.js";

export type {
  SandboxLifecycleStatus,
  WorkbenchSandboxLifecycleStatus,
} from "./session-workbench-state.js";

export type SandboxStatusBadgeUi = {
  label: string;
  variant: "secondary" | "outline" | "destructive";
  className?: string;
};

export function resolveSandboxStatusBadgeUi(
  sandboxLifecycleStatus: WorkbenchSandboxLifecycleStatus,
): SandboxStatusBadgeUi {
  if (sandboxLifecycleStatus === null) {
    return {
      label: "Loading status",
      variant: "outline",
    };
  }

  if (sandboxLifecycleStatus === "failed") {
    return {
      label: "Failed",
      variant: "destructive",
    };
  }

  if (sandboxLifecycleStatus === "running") {
    return {
      label: "Running",
      variant: "secondary",
      className: "bg-emerald-600 text-white hover:bg-emerald-600/90",
    };
  }

  if (sandboxLifecycleStatus === "stopped") {
    return {
      label: "Stopped",
      variant: "outline",
    };
  }

  if (sandboxLifecycleStatus === "resuming") {
    return {
      label: "Resuming",
      variant: "outline",
    };
  }

  if (sandboxLifecycleStatus === "pending") {
    return {
      label: "Pending",
      variant: "outline",
    };
  }

  if (sandboxLifecycleStatus === "started") {
    return {
      label: "Started",
      variant: "outline",
    };
  }

  if (sandboxLifecycleStatus === "initializing") {
    return {
      label: "Initializing",
      variant: "outline",
    };
  }

  if (sandboxLifecycleStatus === "reconnecting") {
    return {
      label: "Reconnecting",
      variant: "outline",
    };
  }

  if (sandboxLifecycleStatus === "stopping") {
    return {
      label: "Stopping",
      variant: "outline",
    };
  }

  return {
    label: "Starting",
    variant: "outline",
  };
}
