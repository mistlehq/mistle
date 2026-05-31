import type { WorkbenchSandboxLifecycleStatus } from "./session-workbench-state.js";

export type {
  SandboxLifecycleStatus,
  WorkbenchSandboxLifecycleStatus,
} from "./session-workbench-state.js";

export type SandboxStatusBadgeUi = {
  label: string;
  variant: "secondary" | "outline" | "destructive";
  className?: string;
  indicatorClassName: string;
};

export function resolveSandboxStatusBadgeUi(
  sandboxLifecycleStatus: WorkbenchSandboxLifecycleStatus,
): SandboxStatusBadgeUi {
  if (sandboxLifecycleStatus === null) {
    return {
      label: "Loading status",
      variant: "outline",
      indicatorClassName: "border-muted-foreground/30 bg-muted-foreground/30",
    };
  }

  if (sandboxLifecycleStatus === "failed") {
    return {
      label: "Failed",
      variant: "destructive",
      indicatorClassName: "border-destructive bg-destructive",
    };
  }

  if (sandboxLifecycleStatus === "running") {
    return {
      label: "Running",
      variant: "secondary",
      className: "bg-emerald-600 text-white hover:bg-emerald-600/90",
      indicatorClassName: "border-emerald-700 bg-emerald-600",
    };
  }

  if (sandboxLifecycleStatus === "stopped") {
    return {
      label: "Stopped",
      variant: "outline",
      className: "border-zinc-400/50 text-zinc-600 dark:text-zinc-300",
      indicatorClassName: "border-muted-foreground/30 bg-muted-foreground/30",
    };
  }

  if (sandboxLifecycleStatus === "resuming") {
    return {
      label: "Resuming",
      variant: "outline",
      className: "border-sky-500/40 text-sky-700 dark:text-sky-300",
      indicatorClassName: "border-amber-600 bg-amber-500",
    };
  }

  if (sandboxLifecycleStatus === "pending") {
    return {
      label: "Pending",
      variant: "outline",
      className: "border-amber-500/45 text-amber-700 dark:text-amber-300",
      indicatorClassName: "border-amber-600 bg-amber-500",
    };
  }

  if (sandboxLifecycleStatus === "starting") {
    return {
      label: "Starting",
      variant: "outline",
      className: "border-amber-500/45 text-amber-700 dark:text-amber-300",
      indicatorClassName: "border-amber-600 bg-amber-500",
    };
  }

  if (sandboxLifecycleStatus === "started") {
    return {
      label: "Started",
      variant: "outline",
      className: "border-blue-500/40 text-blue-700 dark:text-blue-300",
      indicatorClassName: "border-amber-600 bg-amber-500",
    };
  }

  if (sandboxLifecycleStatus === "initializing") {
    return {
      label: "Initializing",
      variant: "outline",
      className: "border-amber-500/45 text-amber-700 dark:text-amber-300",
      indicatorClassName: "border-amber-600 bg-amber-500",
    };
  }

  if (sandboxLifecycleStatus === "reconnecting") {
    return {
      label: "Reconnecting",
      variant: "outline",
      className: "border-amber-500/45 text-amber-700 dark:text-amber-300",
      indicatorClassName: "border-amber-600 bg-amber-500",
    };
  }

  if (sandboxLifecycleStatus === "degraded") {
    return {
      label: "Degraded",
      variant: "outline",
      className: "border-amber-500/45 text-amber-700 dark:text-amber-300",
      indicatorClassName: "border-amber-600 bg-amber-500",
    };
  }

  if (sandboxLifecycleStatus === "stopping") {
    return {
      label: "Stopping",
      variant: "outline",
      className: "border-orange-500/45 text-orange-700 dark:text-orange-300",
      indicatorClassName: "border-amber-600 bg-amber-500",
    };
  }

  return assertUnsupportedSandboxLifecycleStatus(sandboxLifecycleStatus);
}

function assertUnsupportedSandboxLifecycleStatus(status: never): never {
  void status;
  throw new Error("Unsupported sandbox lifecycle status.");
}
