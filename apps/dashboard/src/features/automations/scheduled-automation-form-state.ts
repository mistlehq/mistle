import type {
  ScheduledAutomationFormOption,
  ScheduledAutomationFormValues,
} from "./scheduled-automation-form-types.js";
import { WebhookAutomationWorkspaceRootRepositoryOptionValue } from "./webhook-automation-option-builders.js";

export function resolveScheduledAutomationFormPresentation(input: {
  mode: "create" | "edit";
  values: Pick<ScheduledAutomationFormValues, "primaryRepositoryId" | "sandboxProfileId">;
  primaryRepositoryOptions: readonly ScheduledAutomationFormOption[] | undefined;
}): {
  submitLabel: string;
  shouldShowAutomationEnabledField: boolean;
  shouldShowCreateNameField: boolean;
  shouldShowPrimaryRepositoryField: boolean;
  selectedPrimaryRepositoryPath: string | null;
  selectedWorkspaceRoot: boolean;
} {
  const selectedPrimaryRepositoryOption = input.primaryRepositoryOptions?.find(
    (option) => option.value === input.values.primaryRepositoryId,
  );
  const selectedPrimaryRepositoryPath = selectedPrimaryRepositoryOption?.path ?? null;
  const selectedWorkspaceRoot =
    selectedPrimaryRepositoryOption?.value === WebhookAutomationWorkspaceRootRepositoryOptionValue;

  return {
    submitLabel: input.mode === "create" ? "Create" : "Save",
    shouldShowAutomationEnabledField: input.mode === "edit",
    shouldShowCreateNameField: input.mode === "create",
    shouldShowPrimaryRepositoryField:
      input.values.sandboxProfileId.trim().length > 0 &&
      (input.primaryRepositoryOptions?.length ?? 0) > 0,
    selectedPrimaryRepositoryPath,
    selectedWorkspaceRoot,
  };
}
