import { systemScheduler } from "@mistle/time";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { updateProfileDisplayName } from "../settings/profile/profile-service.js";
import { useRequiredSession } from "../shell/require-auth.js";
import { SESSION_QUERY_KEY } from "../shell/session-query.js";
import { ProfileSettingsPageView } from "./profile-settings-page-view.js";

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
      setFieldError(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not update profile.",
        }),
      );
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
    <ProfileSettingsPageView
      displayName={displayName}
      displayNameDraft={displayNameDraft}
      email={session.user.email}
      fieldError={fieldError}
      hasDirtyChanges={hasDirtyChanges}
      onCancelChanges={handleCancelChanges}
      onDisplayNameChange={handleDisplayNameChange}
      onSaveChanges={handleSaveChanges}
      saveSuccess={saveSuccess}
      saving={saveMutation.isPending}
    />
  );
}
