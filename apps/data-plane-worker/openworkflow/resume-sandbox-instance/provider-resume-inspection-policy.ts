import type { SandboxInspectDisposition } from "@mistle/sandbox";

export type ProviderResumeInspectionState = SandboxInspectDisposition | "missing";

export type ExistingProviderResumeAction =
  | {
      kind: "resume_provider";
    }
  | {
      kind: "use_active_provider";
    }
  | {
      kind: "fail";
      failureCode: string;
      failureMessage: string;
    };

export function determineExistingProviderResumeAction(input: {
  providerState: ProviderResumeInspectionState;
}): ExistingProviderResumeAction {
  switch (input.providerState) {
    case "active":
      return {
        kind: "use_active_provider",
      };
    case "resumable_stopped":
      return {
        kind: "resume_provider",
      };
    case "missing":
      return {
        kind: "fail",
        failureCode: "provider_runtime_missing",
        failureMessage: "Sandbox runtime was not found at the provider before resume.",
      };
    case "terminal_stopped":
    case "stopping":
      return {
        kind: "fail",
        failureCode: "provider_runtime_not_resumable",
        failureMessage: "Sandbox runtime was not resumable at the provider before resume.",
      };
  }
}
