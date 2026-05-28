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
      className: "border-zinc-400/50 text-zinc-600 dark:text-zinc-300",
    };
  }

  if (sandboxLifecycleStatus === "resuming") {
    return {
      label: "Resuming",
      variant: "outline",
      className: "border-sky-500/40 text-sky-700 dark:text-sky-300",
    };
  }

  if (sandboxLifecycleStatus === "pending") {
    return {
      label: "Pending",
      variant: "outline",
      className: "border-amber-500/45 text-amber-700 dark:text-amber-300",
    };
  }

  if (sandboxLifecycleStatus === "starting") {
    return {
      label: "Starting",
      variant: "outline",
      className: "border-sky-500/40 text-sky-700 dark:text-sky-300",
    };
  }

  if (sandboxLifecycleStatus === "started") {
    return {
      label: "Started",
      variant: "outline",
      className: "border-blue-500/40 text-blue-700 dark:text-blue-300",
    };
  }

  if (sandboxLifecycleStatus === "initializing") {
    return {
      label: "Initializing",
      variant: "outline",
      className: "border-indigo-500/40 text-indigo-700 dark:text-indigo-300",
    };
  }

  if (sandboxLifecycleStatus === "reconnecting") {
    return {
      label: "Reconnecting",
      variant: "outline",
      className: "border-amber-500/45 text-amber-700 dark:text-amber-300",
    };
  }

  if (sandboxLifecycleStatus === "stopping") {
    return {
      label: "Stopping",
      variant: "outline",
      className: "border-orange-500/45 text-orange-700 dark:text-orange-300",
    };
  }

  return assertUnsupportedSandboxLifecycleStatus(sandboxLifecycleStatus);
}

function assertUnsupportedSandboxLifecycleStatus(status: never): never {
  void status;
  throw new Error("Unsupported sandbox lifecycle status.");
}
