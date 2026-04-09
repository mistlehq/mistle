import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useNavigate } from "react-router";

import { clearAuthenticatedSessionCache } from "../shell/session-cache.js";
import { fetchSession, SESSION_QUERY_KEY } from "../shell/session-query.js";
import { AuthSwitchOrganizationPageView } from "./auth-switch-organization-page-view.js";

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

  return <AuthSwitchOrganizationPageView />;
}

function buildSwitchOrganizationLoginPath(): string {
  return `/auth/login?error=server_error&error_description=${encodeURIComponent(
    SWITCH_ORGANIZATION_LOGIN_ERROR,
  )}`;
}
