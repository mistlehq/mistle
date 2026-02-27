import { systemScheduler } from "@mistle/time";
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
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { UserIdentitySummary } from "../account/user-identity-summary.js";
import { MembersApiError, updateProfileDisplayName } from "../settings/members/members-api.js";
import { SaveActions } from "../settings/save-actions.js";
import { useRequiredSession } from "../shell/require-auth.js";
import { SESSION_QUERY_KEY } from "../shell/session-query.js";

function toErrorMessage(error: unknown): string {
  if (error instanceof MembersApiError) {
    return error.message;
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Could not update profile.";
}

export function ProfileSettingsPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const session = useRequiredSession();
  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  useEffect(() => {
    setDisplayNameDraft(session.user.name ?? session.user.email);
  }, [session.user.email, session.user.name]);

  useEffect(() => {
    if (!saveSuccess) {
      return;
    }

    const timeoutHandle = systemScheduler.schedule(() => {
      setSaveSuccess(false);
    }, 2000);

    return () => {
      systemScheduler.cancel(timeoutHandle);
    };
  }, [saveSuccess]);

  const saveMutation = useMutation({
    mutationFn: async (displayName: string) => updateProfileDisplayName({ displayName }),
    onSuccess: async () => {
      await queryClient.refetchQueries({
        queryKey: SESSION_QUERY_KEY,
      });
      setFieldError(null);
      setSaveSuccess(true);
    },
    onError: (error: unknown) => {
      setFieldError(toErrorMessage(error));
      setSaveSuccess(false);
    },
  });

  function handleDisplayNameChange(nextValue: string): void {
    setDisplayNameDraft(nextValue);
    setFieldError(null);
    setSaveSuccess(false);
  }

  function handleCancelChanges(): void {
    setDisplayNameDraft(session.user.name ?? session.user.email);
    setFieldError(null);
    setSaveSuccess(false);
  }

  function handleSaveChanges(): void {
    const normalizedDisplayName = displayNameDraft.trim();
    void saveMutation.mutateAsync(normalizedDisplayName);
  }

  const normalizedDisplayName = displayNameDraft.trim();
  const persistedDisplayName = session.user.name ?? session.user.email;
  const hasDirtyChanges = normalizedDisplayName !== persistedDisplayName.trim();
  const displayName = normalizedDisplayName.length > 0 ? normalizedDisplayName : session.user.email;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <UserIdentitySummary email={session.user.email} name={displayName} />
        </CardHeader>
      </Card>
      <Card>
        <CardContent className="gap-4 flex flex-col">
          <p aria-live="polite" className="sr-only" role="status">
            {saveSuccess ? "Profile updated." : ""}
          </p>
          <Field>
            <FieldLabel htmlFor="display-name">Display name</FieldLabel>
            <FieldContent>
              <Input
                id="display-name"
                onChange={(event) => {
                  handleDisplayNameChange(event.target.value);
                }}
                value={displayNameDraft}
              />
            </FieldContent>
            {fieldError ? <FieldError errors={[{ message: fieldError }]} /> : null}
          </Field>
          <Field>
            <FieldLabel>Email</FieldLabel>
            <FieldContent>
              <Input disabled readOnly value={session.user.email} />
            </FieldContent>
          </Field>
          <SaveActions
            cancelDisabled={!hasDirtyChanges || saveMutation.isPending}
            onCancel={handleCancelChanges}
            onSave={handleSaveChanges}
            saveDisabled={!hasDirtyChanges || saveMutation.isPending}
            saveSuccess={saveSuccess}
            saving={saveMutation.isPending}
          />
        </CardContent>
      </Card>
    </div>
  );
}
