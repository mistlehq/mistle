import { Spinner } from "@mistle/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useNavigate } from "react-router";

import { clearAuthenticatedSessionCache } from "../shell/session-cache.js";
import { fetchSession, SESSION_QUERY_KEY } from "../shell/session-query.js";
import { AuthStatusPage } from "./auth-status-page.js";

const SWITCH_ORGANIZATION_LOGIN_ERROR = "Something went wrong. Please sign in again.";

export function AuthSwitchOrganizationPage(): React.JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;

    async function completeOrganizationSwitch(): Promise<void> {
      clearAuthenticatedSessionCache(queryClient);

      try {
        const session = await queryClient.fetchQuery({
          queryKey: SESSION_QUERY_KEY,
          queryFn: fetchSession,
          staleTime: 0,
        });

        if (cancelled) {
          return;
        }

        if (session === null) {
          await navigate(buildSwitchOrganizationLoginPath(), { replace: true });
          return;
        }

        await navigate("/", { replace: true });
      } catch {
        if (cancelled) {
          return;
        }

        await navigate(buildSwitchOrganizationLoginPath(), { replace: true });
      }
    }

    void completeOrganizationSwitch();

    return () => {
      cancelled = true;
    };
  }, [navigate, queryClient]);

  return (
    <AuthStatusPage
      align="center"
      description="Refreshing your session for the selected organization."
      title="Switching organization"
    >
      <div
        aria-live="polite"
        className="text-muted-foreground gap-2 flex items-center justify-center text-sm"
        role="status"
      >
        <Spinner />
        <span className="sr-only">Switching organization.</span>
      </div>
    </AuthStatusPage>
  );
}

function buildSwitchOrganizationLoginPath(): string {
  return `/auth/login?error=server_error&error_description=${encodeURIComponent(
    SWITCH_ORGANIZATION_LOGIN_ERROR,
  )}`;
}
