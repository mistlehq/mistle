import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { getDashboardConfig } from "../../config.js";
import { fetchSession, SESSION_QUERY_KEY } from "../shell/session-query.js";
import { AuthLoginCallbackPageView } from "./auth-login-callback-page-view.js";
import {
  resolveAllowedControlPlaneRedirectOrigins,
  resolveSerializedPostLoginPath,
} from "./auth-redirect.js";

export function AuthLoginCallbackPage(): React.JSX.Element {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [callbackError, setCallbackError] = useState<string | null>(null);
  const redirectTo = resolveSerializedPostLoginPath(searchParams.get("redirectTo"), {
    allowedExternalOrigins: resolveAllowedControlPlaneRedirectOrigins(
      getDashboardConfig().controlPlaneApiOrigin,
    ),
  });

  useEffect(() => {
    let cancelled = false;

    async function completeOAuthSignIn(): Promise<void> {
      try {
        await queryClient.invalidateQueries({
          queryKey: SESSION_QUERY_KEY,
        });

        const session = await queryClient.fetchQuery({
          queryKey: SESSION_QUERY_KEY,
          queryFn: fetchSession,
          staleTime: 0,
        });

        if (cancelled) {
          return;
        }

        if (session === null) {
          setCallbackError("Sign-in did not complete.");
          return;
        }

        if (isAbsoluteHttpUrl(redirectTo)) {
          globalThis.location.assign(redirectTo);
          return;
        }

        await navigate(redirectTo, { replace: true });
      } catch (error) {
        if (cancelled) {
          return;
        }

        setCallbackError(error instanceof Error ? error.message : "Could not complete sign-in.");
      }
    }

    void completeOAuthSignIn();

    return () => {
      cancelled = true;
    };
  }, [navigate, queryClient, redirectTo]);

  return (
    <AuthLoginCallbackPageView
      callbackError={callbackError}
      isCompleting={callbackError === null}
      onBackToLogin={() => {
        void navigate(`/auth/login?redirectTo=${encodeURIComponent(redirectTo)}`, {
          replace: true,
        });
      }}
    />
  );
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
