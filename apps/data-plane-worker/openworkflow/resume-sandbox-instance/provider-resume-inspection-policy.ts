import type { SandboxInspectDisposition } from "@mistle/sandbox";

const PersistentSandboxPersistenceMode = "persistent";

export type ProviderResumeInspectionState = SandboxInspectDisposition | "missing";

export type ExistingProviderResumeAction =
  | {
      kind: "resume_provider";
    }
  | {
      kind: "use_active_provider";
    }
  | {
      kind: "replace_provider_compute";
    }
  | {
      kind: "fail";
      failureCode: string;
      failureMessage: string;
    };

export function determineExistingProviderResumeAction(input: {
  persistenceMode: string;
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
      if (input.persistenceMode === PersistentSandboxPersistenceMode) {
        return {
          kind: "replace_provider_compute",
        };
      }

      return {
        kind: "fail",
        failureCode: "provider_runtime_missing",
        failureMessage: "Sandbox runtime was not found at the provider before resume.",
      };
    case "terminal_stopped":
      if (input.persistenceMode === PersistentSandboxPersistenceMode) {
        return {
          kind: "replace_provider_compute",
        };
      }

      return {
        kind: "fail",
        failureCode: "provider_runtime_not_resumable",
        failureMessage: "Sandbox runtime was not resumable at the provider before resume.",
      };
  }
}
