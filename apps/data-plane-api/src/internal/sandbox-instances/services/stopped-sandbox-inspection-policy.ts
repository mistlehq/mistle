import { SandboxInspectDispositions, type SandboxInspectDisposition } from "@mistle/sandbox";

export function isStoppedSandboxProviderDispositionRecoverable(
  providerDisposition: SandboxInspectDisposition,
): boolean {
  switch (providerDisposition) {
    case SandboxInspectDispositions.ACTIVE:
    case SandboxInspectDispositions.STOPPING:
    case SandboxInspectDispositions.RESUMABLE_STOPPED:
      return true;
    case SandboxInspectDispositions.TERMINAL_STOPPED:
      return false;
  }
}
