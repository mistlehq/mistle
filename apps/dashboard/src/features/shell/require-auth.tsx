import { Button, Notice, Textarea } from "@mistle/ui";
import {
  Navigate,
  Outlet,
  replace,
  type LoaderFunctionArgs,
  useLoaderData,
  useLocation,
} from "react-router";

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

type RequireAuthLoaderData = {
  landingPromptStorageBlockedPrompt: string | null;
};

export function requireAuthLoader(input: LoaderFunctionArgs): RequireAuthLoaderData {
  const url = new URL(input.request.url);
  const result = captureDesignerLandingPromptHandoff({
    createIdempotencyKey: () => crypto.randomUUID(),
    nowMs: Date.now(),
    pathname: url.pathname,
    search: url.search,
    storage: getBestEffortBrowserStorage("session"),
  });

  if (result.kind === "captured" || result.kind === "ignored-invalid-prompt") {
    throw replace(createSanitizedPath({ url, search: result.sanitizedSearch }));
  }

  if (result.kind === "storage-blocked") {
    replaceCurrentHistoryEntry(createSanitizedPath({ url, search: result.sanitizedSearch }));
    return {
      landingPromptStorageBlockedPrompt: result.prompt,
    };
  }

  return {
    landingPromptStorageBlockedPrompt: null,
  };
}

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
  const loaderData = useLoaderData<typeof requireAuthLoader>();
  if (loaderData.landingPromptStorageBlockedPrompt !== null) {
    return (
      <LandingPromptStorageBlockedNotice prompt={loaderData.landingPromptStorageBlockedPrompt} />
    );
  }

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
    return <Navigate replace state={{ from: location }} to="/auth/login" />;
  }

  const appearance = readUserAppearanceFromSession(sessionQuery.data);
  const activeOrganizationId = resolveActiveOrganizationIdFromSession(sessionQuery.data);
  if (activeOrganizationId === null) {
    return (
      <AppearanceProvider appearance={appearance}>
        <Navigate replace state={{ from: location }} to={AUTH_CREATE_ORGANIZATION_PATH} />
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

function createSanitizedPath(input: { url: URL; search: string }): string {
  return `${input.url.pathname}${input.search}${input.url.hash}`;
}

function replaceCurrentHistoryEntry(path: string): void {
  if (typeof window === "undefined") {
    return;
  }

  window.history.replaceState(window.history.state, "", path);
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
