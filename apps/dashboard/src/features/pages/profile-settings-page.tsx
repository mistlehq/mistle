import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
} from "@mistle/ui";
import { useEffect, useState } from "react";

import { SaveActions } from "../settings/save-actions.js";
import { useRequiredSession } from "../shell/require-auth.js";

export function ProfileSettingsPage(): React.JSX.Element {
  const session = useRequiredSession();
  const initialDisplayName = session.user.name ?? session.user.email;
  const [savedDisplayName, setSavedDisplayName] = useState(initialDisplayName);
  const [displayNameDraft, setDisplayNameDraft] = useState(initialDisplayName);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    setSavedDisplayName(initialDisplayName);
    setDisplayNameDraft(initialDisplayName);
    setSaveSuccess(false);
  }, [initialDisplayName]);

  const normalizedDisplayName = displayNameDraft.trim();
  const hasDisplayNameError = normalizedDisplayName.length === 0;
  const hasDirtyChanges = normalizedDisplayName !== savedDisplayName.trim();

  function handleSave(): void {
    if (hasDisplayNameError) {
      return;
    }

    setSavedDisplayName(normalizedDisplayName);
    setDisplayNameDraft(normalizedDisplayName);
    setSaveSuccess(true);
  }

  function handleCancel(): void {
    setDisplayNameDraft(savedDisplayName);
    setSaveSuccess(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your profile</CardTitle>
        <CardDescription>
          Profile editing is UI-only in this slice. Data persistence wiring follows in a later
          slice.
        </CardDescription>
      </CardHeader>
      <CardContent className="gap-4 flex flex-col">
        <p aria-live="polite" className="sr-only" role="status">
          {saveSuccess ? "Profile settings saved." : ""}
        </p>
        <Field>
          <FieldLabel htmlFor="profile-display-name">Display name</FieldLabel>
          <FieldContent>
            <Input
              id="profile-display-name"
              onChange={(event) => {
                setDisplayNameDraft(event.target.value);
                setSaveSuccess(false);
              }}
              value={displayNameDraft}
            />
          </FieldContent>
          <FieldDescription>This name is shown across the dashboard.</FieldDescription>
          {hasDisplayNameError ? (
            <FieldError errors={[{ message: "Display name is required." }]} />
          ) : null}
        </Field>
        <Field>
          <FieldLabel>Email</FieldLabel>
          <FieldContent>
            <Input disabled readOnly value={session.user.email} />
          </FieldContent>
        </Field>
        <SaveActions
          cancelDisabled={!hasDirtyChanges}
          onCancel={handleCancel}
          onSave={handleSave}
          saveDisabled={!hasDirtyChanges || hasDisplayNameError}
          saveSuccess={saveSuccess}
          saving={false}
        />
      </CardContent>
    </Card>
  );
}
