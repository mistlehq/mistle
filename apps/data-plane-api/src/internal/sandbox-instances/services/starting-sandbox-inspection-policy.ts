import { SandboxInspectDispositions, type SandboxInspectDisposition } from "@mistle/sandbox";

export const StartingSandboxInspectionOutcomes = {
  KEEP_STARTING: "keep_starting",
  FAIL: "fail",
} as const;

export type StartingSandboxInspectionOutcome =
  | {
      kind: typeof StartingSandboxInspectionOutcomes.KEEP_STARTING;
    }
  | {
      kind: typeof StartingSandboxInspectionOutcomes.FAIL;
      failureCode: string;
      failureMessage: string;
    };

const StartingInspectionFailureCodes = {
  PROVIDER_RUNTIME_STOPPED_DURING_STARTUP: "provider_runtime_stopped_during_startup",
} as const;

export function determineStartingSandboxInspectionOutcome(input: {
  providerDisposition: SandboxInspectDisposition;
}): StartingSandboxInspectionOutcome {
  switch (input.providerDisposition) {
    case SandboxInspectDispositions.ACTIVE:
    case SandboxInspectDispositions.STOPPING:
    case SandboxInspectDispositions.RESUMABLE_STOPPED:
      return {
        kind: StartingSandboxInspectionOutcomes.KEEP_STARTING,
      };
    case SandboxInspectDispositions.TERMINAL_STOPPED:
      return {
        kind: StartingSandboxInspectionOutcomes.FAIL,
        failureCode: StartingInspectionFailureCodes.PROVIDER_RUNTIME_STOPPED_DURING_STARTUP,
        failureMessage:
          "Sandbox runtime was not running at the provider during startup inspection.",
      };
  }
}
