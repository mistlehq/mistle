import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { useAppPageMeta } from "../navigation/route-meta.js";
import { updateProfileDisplayName } from "../settings/profile/profile-service.js";
import { FormPageFrame, resolvePageFrameText } from "../shared/page-frame.js";
import { resolveUserDisplayName } from "../shared/user-display-name.js";
import { useRequiredSession } from "../shell/require-auth.js";
import { SESSION_QUERY_KEY } from "../shell/session-query-key.js";
import { ProfileSettingsPageView } from "./profile-settings-page-view.js";

export function ProfileSettingsPage(): React.JSX.Element {
  const pageMeta = useAppPageMeta();
  const queryClient = useQueryClient();
  const session = useRequiredSession();
  const { title, description } = resolvePageFrameText(pageMeta, "Profile");

  const saveMutation = useMutation({
    mutationFn: async (displayName: string) => updateProfileDisplayName({ displayName }),
    onSuccess: async () => {
      await queryClient.refetchQueries({
        queryKey: SESSION_QUERY_KEY,
      });
    },
  });

  const persistedDisplayName = resolveUserDisplayName(session.user);

  return (
    <FormPageFrame description={description} title={title}>
      <ProfileSettingsEditor
        key={`${session.user.email}:${persistedDisplayName}`}
        email={session.user.email}
        onDisplayNameSave={async (displayNameDraft) => {
          await saveMutation.mutateAsync(displayNameDraft.trim());
        }}
        persistedDisplayName={persistedDisplayName}
        saving={saveMutation.isPending}
      />
    </FormPageFrame>
  );
}

function ProfileSettingsEditor(input: {
  persistedDisplayName: string;
  email: string;
  saving: boolean;
  onDisplayNameSave: (displayNameDraft: string) => Promise<void>;
}): React.JSX.Element {
  const [fieldError, setFieldError] = useState<string | null>(null);

  return (
    <ProfileSettingsPageView
      displayName={input.persistedDisplayName}
      email={input.email}
      fieldError={fieldError}
      onSaveChanges={async (displayNameDraft) => {
        setFieldError(null);

        try {
          await input.onDisplayNameSave(displayNameDraft);
        } catch (error) {
          setFieldError(
            resolveApiErrorMessage({
              error,
              fallbackMessage: "Could not update profile.",
            }),
          );
        }
      }}
      saving={input.saving}
    />
  );
}
