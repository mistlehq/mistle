import { Field, FieldContent, FieldHeader, FieldLabel, Input } from "@mistle/ui";

import { UserIdentitySummary } from "../account/user-identity-summary.js";
import { AutoSaveTextField } from "../forms/auto-save-text-field.js";
import { FormPageSection, FormPageStack } from "../shared/form-page.js";

export type ProfileSettingsPageViewProps = {
  displayName: string;
  email: string;
  onSaveChanges: (displayName: string) => Promise<void>;
  saving: boolean;
};

export function ProfileSettingsPageView(props: ProfileSettingsPageViewProps): React.JSX.Element {
  return (
    <FormPageStack>
      <FormPageSection>
        <div className="p-4">
          <UserIdentitySummary email={props.email} name={props.displayName} />
        </div>
      </FormPageSection>

      <FormPageSection>
        <div className="flex flex-col gap-4 p-4">
          <AutoSaveTextField
            disabled={props.saving}
            id="display-name"
            label="Display name"
            onSave={props.onSaveChanges}
            validate={() => null}
            value={props.displayName}
          />
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
    </FormPageStack>
  );
}
