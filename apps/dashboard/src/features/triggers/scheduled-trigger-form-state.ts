import type {
  ScheduledTriggerFormOption,
  ScheduledTriggerFormValues,
} from "./scheduled-trigger-form-types.js";
import { WebhookTriggerWorkspaceRootRepositoryOptionValue } from "./webhook-trigger-option-builders.js";

export function resolveScheduledTriggerFormPresentation(input: {
  mode: "create" | "edit";
  values: Pick<ScheduledTriggerFormValues, "primaryRepositoryId" | "sandboxProfileId">;
  primaryRepositoryOptions: readonly ScheduledTriggerFormOption[] | undefined;
}): {
  submitLabel: string;
  shouldShowTriggerEnabledField: boolean;
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
    selectedPrimaryRepositoryOption?.value === WebhookTriggerWorkspaceRootRepositoryOptionValue;

  return {
    submitLabel: input.mode === "create" ? "Create" : "Save",
    shouldShowTriggerEnabledField: input.mode === "edit",
    shouldShowCreateNameField: input.mode === "create",
    shouldShowPrimaryRepositoryField:
      input.values.sandboxProfileId.trim().length > 0 &&
      (input.primaryRepositoryOptions?.length ?? 0) > 0,
    selectedPrimaryRepositoryPath,
    selectedWorkspaceRoot,
  };
}
