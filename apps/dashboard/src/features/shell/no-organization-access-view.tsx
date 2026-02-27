import { useMutation, useQueryClient } from "@tanstack/react-query";

import { authClient } from "../../lib/auth/client.js";
import { AuthPageShell, AuthPageWidths } from "../auth/auth-page-shell.js";
import { NoOrganizationAccessViewContent } from "./no-organization-access-view-content.js";
import { requireAuthenticatedSession } from "./session-context.js";
import { SESSION_QUERY_KEY, useSessionQuery } from "./session-query.js";

export function NoOrganizationAccessView(): React.JSX.Element {
  const sessionQuery = useSessionQuery();
  const queryClient = useQueryClient();
  const session = requireAuthenticatedSession(sessionQuery.data ?? null);

  const signOutMutation = useMutation({
    mutationFn: async () => {
      const response = await authClient.signOut();
      if (response.error !== null) {
        throw new Error(response.error.message ?? "Unable to sign out.");
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: SESSION_QUERY_KEY,
      });
    },
  });

  function handleSignOut(): void {
    signOutMutation.mutate();
  }

  return (
    <AuthPageShell maxWidthClass={AuthPageWidths.SM} title={null}>
      <NoOrganizationAccessViewContent
        email={session.user.email}
        isSigningOut={signOutMutation.isPending}
        onSignOut={handleSignOut}
      />
    </AuthPageShell>
  );
}
