import { useMutation, useQueryClient } from "@tanstack/react-query";

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
      <ProfileSettingsPageView
        displayName={persistedDisplayName}
        email={session.user.email}
        onSaveChanges={async (displayNameDraft) => {
          await saveMutation.mutateAsync(displayNameDraft.trim());
        }}
        saving={saveMutation.isPending}
      />
    </FormPageFrame>
  );
}
