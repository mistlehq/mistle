import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@mistle/ui";
import { Navigate, Outlet, useLocation } from "react-router";

import type { SessionData } from "../auth/types.js";

import {
  MISSING_ACTIVE_ORGANIZATION_ERROR_MESSAGE,
  resolveActiveOrganizationIdFromSession,
} from "./active-organization.js";
import { NoOrganizationRecoveryCard } from "./no-organization-recovery-card.js";
import { PendingSessionShell } from "./pending-session-shell.js";
import { requireAuthenticatedSession } from "./session-context.js";
import { useSessionQuery } from "./session-query.js";

type AuthenticatedSession = Exclude<SessionData, null>;

export function useRequiredSession(): AuthenticatedSession {
  const sessionQuery = useSessionQuery();
  if (sessionQuery.isError) {
    throw sessionQuery.error;
  }

  return requireAuthenticatedSession(sessionQuery.data ?? null);
}

export function useRequiredOrganizationId(): string {
  const session = useRequiredSession();
  const activeOrganizationId = resolveActiveOrganizationIdFromSession(session);
  if (activeOrganizationId === null) {
    throw new Error(MISSING_ACTIVE_ORGANIZATION_ERROR_MESSAGE);
  }

  return activeOrganizationId;
}

export function RequireAuth(): React.JSX.Element {
  const sessionQuery = useSessionQuery();
  const location = useLocation();

  if (sessionQuery.isPending) {
    return <PendingSessionShell />;
  }

  if (sessionQuery.isError) {
    return (
      <main className="from-background to-muted/20 min-h-svh bg-linear-to-b">
        <div className="mx-auto flex min-h-svh w-full max-w-xl items-center px-4 py-8">
          <Card className="w-full">
            <CardHeader>
              <CardTitle>Mistle dashboard</CardTitle>
              <CardDescription>Session error</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-destructive text-sm">{sessionQuery.error.message}</p>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  if (sessionQuery.data === null) {
    return <Navigate replace state={{ from: location }} to="/auth/login" />;
  }

  if (resolveActiveOrganizationIdFromSession(sessionQuery.data) === null) {
    return <NoOrganizationRecoveryCard />;
  }

  return <Outlet />;
}
