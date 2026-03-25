import { Field, FieldContent, FieldError, FieldHeader, FieldLabel, Input } from "@mistle/ui";

import { UserIdentitySummary } from "../account/user-identity-summary.js";
import { SaveActions } from "../settings/save-actions.js";
import { FormPageSection, FormPageShell } from "../shared/form-page.js";

export type ProfileSettingsPageViewProps = {
  displayName: string;
  displayNameDraft: string;
  email: string;
  fieldError: string | null;
  hasDirtyChanges: boolean;
  onCancelChanges: () => void;
  onDisplayNameChange: (nextValue: string) => void;
  onSaveChanges: () => void;
  saveSuccess: boolean;
  saving: boolean;
};

export function ProfileSettingsPageView(props: ProfileSettingsPageViewProps): React.JSX.Element {
  return (
    <FormPageShell className="pt-0">
      <FormPageSection>
        <div className="p-4">
          <UserIdentitySummary email={props.email} name={props.displayName} />
        </div>
      </FormPageSection>

      <FormPageSection>
        <div className="flex flex-col gap-4 p-4">
          <p aria-live="polite" className="sr-only" role="status">
            {props.saveSuccess ? "Personal settings updated." : ""}
          </p>
          <Field contentWidth="fill" orientation="horizontal">
            <FieldHeader>
              <FieldLabel htmlFor="display-name">Display name</FieldLabel>
            </FieldHeader>
            <FieldContent>
              <Input
                id="display-name"
                onChange={(event) => {
                  props.onDisplayNameChange(event.target.value);
                }}
                value={props.displayNameDraft}
              />
            </FieldContent>
            {props.fieldError ? <FieldError errors={[{ message: props.fieldError }]} /> : null}
          </Field>
          <Field contentWidth="fill" orientation="horizontal">
            <FieldHeader>
              <FieldLabel>Email</FieldLabel>
            </FieldHeader>
            <FieldContent>
              <Input disabled readOnly value={props.email} />
            </FieldContent>
          </Field>
        </div>
      </FormPageSection>

      <SaveActions
        cancelDisabled={!props.hasDirtyChanges || props.saving}
        onCancel={props.onCancelChanges}
        onSave={props.onSaveChanges}
        saveDisabled={!props.hasDirtyChanges || props.saving}
        saveSuccess={props.saveSuccess}
        saving={props.saving}
      />
    </FormPageShell>
  );
}
