import { Button, Field, FieldContent, FieldHeader, FieldLabel, Input, Notice } from "@mistle/ui";
import { useId, useRef } from "react";

import { UserIdentitySummary } from "../account/user-identity-summary.js";
import { AutoSaveTextField } from "../forms/auto-save-text-field.js";
import { FormPageSection, FormPageStack } from "../shared/form-page.js";

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
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <FormPageStack>
      <FormPageSection>
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
          <UserIdentitySummary
            email={props.email}
            imageUrl={props.imageUrl}
            name={props.displayName}
          />
          <div className="flex flex-wrap gap-2">
            <input
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              disabled={props.profileImageBusy}
              id={fileInputId}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0] ?? null;
                event.currentTarget.value = "";
                if (file === null) {
                  return;
                }

                void props.onUploadProfileImage(file).catch(() => {});
              }}
              ref={fileInputRef}
              type="file"
            />
            <Button
              disabled={props.profileImageBusy}
              onClick={() => {
                fileInputRef.current?.click();
              }}
              type="button"
              variant="outline"
            >
              {props.imageUrl === null ? "Upload image" : "Replace image"}
            </Button>
            <Button
              disabled={props.profileImageBusy || props.imageUrl === null}
              onClick={() => {
                void props.onDeleteProfileImage().catch(() => {});
              }}
              type="button"
              variant="ghost"
            >
              Remove image
            </Button>
          </div>
          <label className="sr-only" htmlFor={fileInputId}>
            Upload profile image
          </label>
        </div>
        {props.profileImageErrorMessage === null ? null : (
          <div className="px-4 pb-4">
            <Notice variant="alert">
              {props.profileImageErrorMessage} Please try again later.
            </Notice>
          </div>
        )}
        {props.profileImageBusy ? (
          <p className="text-muted-foreground px-4 pb-4 text-sm">Updating profile image...</p>
        ) : null}
        <div className="sr-only" aria-live="polite" role="status">
          {props.profileImageBusy ? "Updating profile image" : ""}
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
