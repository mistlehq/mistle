export type SandboxLifecycleStatus = "pending" | "starting" | "running" | "stopped" | "failed";

export type WorkbenchSandboxLifecycleStatus = SandboxLifecycleStatus | "resuming" | null;

export type SandboxStatusBadgeUi = {
  label: string;
  variant: "secondary" | "outline" | "destructive";
  className?: string;
};

export function resolveSandboxStatusBadgeUi(
  sandboxLifecycleStatus: WorkbenchSandboxLifecycleStatus,
): SandboxStatusBadgeUi {
  if (sandboxLifecycleStatus === "failed") {
    return {
      label: "Sandbox failed",
      variant: "destructive",
    };
  }

  if (sandboxLifecycleStatus === "running") {
    return {
      label: "Connected",
      variant: "secondary",
      className: "bg-emerald-600 text-white hover:bg-emerald-600/90",
    };
  }

  if (sandboxLifecycleStatus === "stopped") {
    return {
      label: "Sandbox stopped",
      variant: "outline",
    };
  }

  if (sandboxLifecycleStatus === "resuming") {
    return {
      label: "Resuming sandbox",
      variant: "outline",
    };
  }

  return {
    label: "Starting sandbox",
    variant: "outline",
  };
}
