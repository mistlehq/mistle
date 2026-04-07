import { Input, Field, FieldContent, FieldHeader, FieldLabel } from "@mistle/ui";

import { AutoSaveTextField } from "../forms/auto-save-text-field.js";
import { FormPageSection, FormPageStack } from "../shared/form-page.js";
import { SettingsImageField } from "../shared/settings-image-field.js";

export type ProfileSettingsPageViewProps = {
  displayName: string;
  email: string;
  imageUrl: string | null;
  onDeleteProfileImage: () => Promise<void>;
  onSaveChanges: (displayName: string) => Promise<void>;
  onUploadProfileImage: (file: File) => Promise<void>;
  profileImageBusy: boolean;
  profileImageErrorMessage: string | null;
  saving: boolean;
};

export function ProfileSettingsPageView(props: ProfileSettingsPageViewProps): React.JSX.Element {
  return (
    <FormPageStack>
      <FormPageSection>
        <div className="flex flex-col gap-4 p-4">
          <SettingsImageField
            alt={`${props.displayName} profile image`}
            busy={props.profileImageBusy}
            errorMessage={props.profileImageErrorMessage}
            fallbackInitial="U"
            imageUrl={props.imageUrl}
            imageName="profile image"
            label="Avatar"
            name={props.displayName}
            onDelete={props.onDeleteProfileImage}
            onUpload={props.onUploadProfileImage}
          />
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
