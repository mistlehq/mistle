import {
  Button,
  Field,
  FieldContent,
  FieldError,
  FieldHeader,
  FieldLabel,
  Input,
} from "@mistle/ui";
import { useRef } from "react";

import { UserIdentitySummary } from "../account/user-identity-summary.js";
import { SaveActions } from "../settings/save-actions.js";
import { FormPageSection, FormPageShell } from "../shared/form-page.js";

export type ProfileSettingsPageViewProps = {
  avatarError: string | null;
  avatarMutating: boolean;
  avatarUrl: string | null;
  displayName: string;
  displayNameDraft: string;
  email: string;
  fieldError: string | null;
  hasDirtyChanges: boolean;
  hasAvatar: boolean;
  onAvatarFileSelected: (file: File) => void;
  onAvatarRemove: () => void;
  onCancelChanges: () => void;
  onDisplayNameChange: (nextValue: string) => void;
  onSaveChanges: () => void;
  saveSuccess: boolean;
  saving: boolean;
};

export function ProfileSettingsPageView(props: ProfileSettingsPageViewProps): React.JSX.Element {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <FormPageShell className="pt-0">
      <FormPageSection>
        <div className="flex flex-col gap-4 p-4">
          <UserIdentitySummary
            avatarUrl={props.avatarUrl}
            email={props.email}
            name={props.displayName}
          />
          <div className="flex flex-wrap items-center gap-2">
            <input
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file !== undefined) {
                  props.onAvatarFileSelected(file);
                }
              }}
              ref={fileInputRef}
              type="file"
            />
            <Button
              disabled={props.avatarMutating}
              onClick={() => {
                fileInputRef.current?.click();
              }}
              type="button"
              variant="outline"
            >
              {props.avatarMutating
                ? "Uploading..."
                : props.hasAvatar
                  ? "Replace avatar"
                  : "Upload avatar"}
            </Button>
            {props.hasAvatar ? (
              <Button
                disabled={props.avatarMutating}
                onClick={props.onAvatarRemove}
                type="button"
                variant="outline"
              >
                Remove avatar
              </Button>
            ) : null}
          </div>
          {props.avatarError ? <FieldError errors={[{ message: props.avatarError }]} /> : null}
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
