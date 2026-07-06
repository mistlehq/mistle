import { Button, Notice, Textarea } from "@mistle/ui";
import { useRef } from "react";
import { Navigate, Outlet, useLocation } from "react-router";

import { AuthenticatedAnalytics } from "../../lib/analytics/authenticated.js";
import { AppearanceProvider, SystemAppearanceProvider } from "../appearance/appearance-provider.js";
import { readUserAppearanceFromSession } from "../appearance/appearance.js";
import { AUTH_CREATE_ORGANIZATION_PATH } from "../auth/auth-create-organization-page.js";
import type { SessionData } from "../auth/types.js";
import { captureDesignerLandingPromptHandoff } from "../designer/designer-landing-handoff.js";
import { getBestEffortBrowserStorage } from "../shared/browser-storage.js";
import {
  MISSING_ACTIVE_ORGANIZATION_ERROR_MESSAGE,
  resolveActiveOrganizationIdFromSession,
} from "./active-organization.js";
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
  const landingPromptCaptureRef = useRef<{
    locationKey: string;
    result: ReturnType<typeof captureDesignerLandingPromptHandoff>;
  } | null>(null);
  const landingPromptLocationKey = `${location.pathname}\n${location.search}`;
  if (landingPromptCaptureRef.current?.locationKey !== landingPromptLocationKey) {
    const result = captureDesignerLandingPromptHandoff({
      createIdempotencyKey: () => crypto.randomUUID(),
      nowMs: Date.now(),
      pathname: location.pathname,
      search: location.search,
      storage: getBestEffortBrowserStorage("session"),
    });
    if (
      result.kind === "captured" ||
      result.kind === "ignored-invalid-prompt" ||
      result.kind === "storage-blocked"
    ) {
      replaceCurrentSearch(result.sanitizedSearch);
    }
    landingPromptCaptureRef.current = {
      locationKey: landingPromptLocationKey,
      result,
    };
  }

  const landingPromptCapture = landingPromptCaptureRef.current.result;
  if (landingPromptCapture.kind === "storage-blocked") {
    return <LandingPromptStorageBlockedNotice prompt={landingPromptCapture.prompt} />;
  }
  const redirectLocation =
    landingPromptCapture.kind === "captured" ||
    landingPromptCapture.kind === "ignored-invalid-prompt"
      ? {
          ...location,
          search: landingPromptCapture.sanitizedSearch,
        }
      : location;

  if (sessionQuery.isPending) {
    return (
      <SystemAppearanceProvider>
        <PendingSessionShell />
      </SystemAppearanceProvider>
    );
  }

  if (sessionQuery.isError) {
    throw sessionQuery.error;
  }

  if (sessionQuery.data === null) {
    return <Navigate replace state={{ from: redirectLocation }} to="/auth/login" />;
  }

  const appearance = readUserAppearanceFromSession(sessionQuery.data);
  const activeOrganizationId = resolveActiveOrganizationIdFromSession(sessionQuery.data);
  if (activeOrganizationId === null) {
    return (
      <AppearanceProvider appearance={appearance}>
        <Navigate replace state={{ from: redirectLocation }} to={AUTH_CREATE_ORGANIZATION_PATH} />
      </AppearanceProvider>
    );
  }

  return (
    <AppearanceProvider appearance={appearance}>
      <AuthenticatedAnalytics
        organizationId={activeOrganizationId}
        userId={sessionQuery.data.user.id}
      />
      <Outlet />
    </AppearanceProvider>
  );
}

function replaceCurrentSearch(search: string): void {
  if (typeof window === "undefined") {
    return;
  }

  const nextUrl = `${window.location.pathname}${search}${window.location.hash}`;
  window.history.replaceState(window.history.state, "", nextUrl);
}

function LandingPromptStorageBlockedNotice(input: { prompt: string }): React.JSX.Element {
  function handleCopyPrompt(): void {
    if (
      typeof navigator === "undefined" ||
      navigator.clipboard === undefined ||
      typeof navigator.clipboard.writeText !== "function"
    ) {
      return;
    }

    void navigator.clipboard.writeText(input.prompt).catch(() => {});
  }

  return (
    <SystemAppearanceProvider>
      <main className="bg-background text-foreground flex min-h-screen items-center justify-center px-6 py-10">
        <div className="grid w-full max-w-xl gap-4">
          <Notice aria-atomic="true" title="Temporary storage blocked" variant="alert">
            This browser blocked temporary storage, so Mistle can’t carry your prompt through login
            automatically. Copy the prompt below, log in, then paste it after login.
          </Notice>
          <div className="grid gap-3">
            <Button onClick={handleCopyPrompt} type="button">
              Copy prompt
            </Button>
            <Textarea aria-label="Prompt to copy" readOnly rows={8} value={input.prompt} />
          </div>
        </div>
      </main>
    </SystemAppearanceProvider>
  );
}
