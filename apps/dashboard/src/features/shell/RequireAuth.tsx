import { Card, CardContent, CardDescription, CardHeader, CardTitle, Spinner } from "@mistle/ui";
import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation, useOutletContext } from "react-router";

import type { SessionData } from "../auth/types.js";

import { authClient } from "../../lib/auth/client.js";
import { resolveErrorMessage } from "../auth/messages.js";

type AuthenticatedSession = Exclude<SessionData, null>;

type AuthenticatedOutletContext = {
  session: AuthenticatedSession;
};

export function useRequiredSession(): AuthenticatedSession {
  const context = useOutletContext<AuthenticatedOutletContext>();
  return context.session;
}

export function RequireAuth(): React.JSX.Element {
  const [session, setSession] = useState<SessionData>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const location = useLocation();

  useEffect(() => {
    let active = true;

    async function loadSession(): Promise<void> {
      setIsLoading(true);
      const response = await authClient.getSession();

      if (!active) {
        return;
      }

      if (response.error) {
        if (response.error.status === 401) {
          setSession(null);
          setErrorMessage(null);
          setIsLoading(false);
          return;
        }

        setSession(null);
        setErrorMessage(resolveErrorMessage(response.error, "Unable to load session."));
        setIsLoading(false);
        return;
      }

      setSession(response.data);
      setErrorMessage(null);
      setIsLoading(false);
    }

    void loadSession();

    return () => {
      active = false;
    };
  }, []);

  if (isLoading) {
    return (
      <main className="from-background to-muted/20 min-h-svh bg-linear-to-b">
        <div className="mx-auto flex min-h-svh w-full max-w-xl items-center px-4 py-8">
          <Card className="w-full">
            <CardHeader>
              <CardTitle>Mistle dashboard</CardTitle>
              <CardDescription>Preparing your session.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-muted-foreground gap-2 flex items-center">
                <Spinner />
                Loading session...
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  if (errorMessage) {
    return (
      <main className="from-background to-muted/20 min-h-svh bg-linear-to-b">
        <div className="mx-auto flex min-h-svh w-full max-w-xl items-center px-4 py-8">
          <Card className="w-full">
            <CardHeader>
              <CardTitle>Mistle dashboard</CardTitle>
              <CardDescription>Session error</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-destructive text-sm">{errorMessage}</p>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  if (!session) {
    return <Navigate replace state={{ from: location }} to="/auth/login" />;
  }

  return <Outlet context={{ session }} />;
}
