import { Field, FieldContent, FieldHeader, FieldLabel, Input, Skeleton } from "@mistle/ui";

import { SaveActions } from "../settings/save-actions.js";
import { FormPageSection, FormPageShell } from "../shared/form-page.js";
import { StatusBox } from "../shared/status-box.js";

export type OrganizationGeneralSettingsPageViewProps = {
  hasDirtyChanges: boolean;
  isLoading: boolean;
  isSaving: boolean;
  loadErrorMessage: string | null;
  name: string;
  nameErrorMessage: string | null;
  onCancelChanges: () => void;
  onNameChange: (nextValue: string) => void;
  onSaveChanges: () => void;
  saveErrorMessage: string | null;
  saveSuccess: boolean;
};

export function OrganizationGeneralSettingsPageView(
  props: OrganizationGeneralSettingsPageViewProps,
): React.JSX.Element {
  if (props.isLoading) {
    return (
      <FormPageShell className="pt-0">
        <FormPageSection>
          <div className="flex flex-col gap-4 p-4">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-10 w-full" />
            </div>
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-3 w-64" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-9 w-20" />
              <Skeleton className="h-9 w-20" />
            </div>
          </div>
        </FormPageSection>
      </FormPageShell>
    );
  }

  if (props.loadErrorMessage) {
    return (
      <FormPageShell className="pt-0">
        <FormPageSection>
          <div className="flex flex-col gap-3 p-4">
            <StatusBox tone="destructive">
              {props.loadErrorMessage} Please try again later.
            </StatusBox>
          </div>
        </FormPageSection>
      </FormPageShell>
    );
  }

  return (
    <FormPageShell className="pt-0">
      <FormPageSection>
        <div className="flex flex-col gap-4 p-4">
          <p aria-live="polite" className="sr-only" role="status">
            {props.saveSuccess ? "Organization settings updated." : ""}
          </p>

          {props.saveErrorMessage !== null || props.nameErrorMessage !== null ? (
            <StatusBox tone="destructive">
              {props.saveErrorMessage !== null
                ? `${props.saveErrorMessage} Please try again later.`
                : props.nameErrorMessage}
            </StatusBox>
          ) : null}

          <Field contentWidth="fill" orientation="horizontal">
            <FieldHeader>
              <FieldLabel htmlFor="organization-name">Organization name</FieldLabel>
            </FieldHeader>
            <FieldContent>
              <Input
                aria-invalid={props.nameErrorMessage !== null ? true : undefined}
                id="organization-name"
                onChange={(event) => props.onNameChange(event.currentTarget.value)}
                value={props.name}
              />
            </FieldContent>
          </Field>
        </div>
      </FormPageSection>

      <SaveActions
        cancelDisabled={!props.hasDirtyChanges || props.isSaving}
        onCancel={props.onCancelChanges}
        onSave={props.onSaveChanges}
        saveDisabled={!props.hasDirtyChanges || props.nameErrorMessage !== null || props.isSaving}
        saveSuccess={props.saveSuccess}
        saving={props.isSaving}
      />
    </FormPageShell>
  );
}
