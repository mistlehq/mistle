import {
  Card,
  CardContent,
  CardHeader,
  Field,
  FieldContent,
  FieldError,
  FieldLabel,
  Input,
} from "@mistle/ui";

import { UserIdentitySummary } from "../account/user-identity-summary.js";
import { SaveActions } from "../settings/save-actions.js";

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
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <UserIdentitySummary email={props.email} name={props.displayName} />
        </CardHeader>
      </Card>
      <Card>
        <CardContent className="flex flex-col gap-4">
          <p aria-live="polite" className="sr-only" role="status">
            {props.saveSuccess ? "Personal settings updated." : ""}
          </p>
          <Field>
            <FieldLabel htmlFor="display-name">Display name</FieldLabel>
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
          <Field>
            <FieldLabel>Email</FieldLabel>
            <FieldContent>
              <Input disabled readOnly value={props.email} />
            </FieldContent>
          </Field>
          <SaveActions
            cancelDisabled={!props.hasDirtyChanges || props.saving}
            onCancel={props.onCancelChanges}
            onSave={props.onSaveChanges}
            saveDisabled={!props.hasDirtyChanges || props.saving}
            saveSuccess={props.saveSuccess}
            saving={props.saving}
          />
        </CardContent>
      </Card>
    </div>
  );
}
