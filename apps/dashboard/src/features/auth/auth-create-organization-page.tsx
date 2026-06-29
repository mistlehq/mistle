import { Spinner } from "@mistle/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";

import { authClient } from "../../lib/auth/client.js";
import { AppearanceProvider } from "../appearance/appearance-provider.js";
import { readUserAppearanceFromSession } from "../appearance/appearance.js";
import { resolveActiveOrganizationIdFromSession } from "../shell/active-organization.js";
import {
  createOrganizationCreateSlug,
  resolveOrganizationOnboardingNameError,
  resolveOrganizationOnboardingValidation,
} from "../shell/organization-onboarding.js";
import { createOrganization, switchActiveOrganization } from "../shell/organization-switcher.js";
import { clearAuthenticatedSessionCache } from "../shell/session-cache.js";
import { SESSION_QUERY_KEY, useSessionQuery } from "../shell/session-query.js";
import { AuthPageShell, AuthPageWidths } from "./auth-page-shell.js";
import { AUTH_SWITCH_ORGANIZATION_PATH } from "./auth-switch-organization-page.js";
import { CreateOrganizationPageContent } from "./create-organization-page-content.js";
import { resolveErrorMessage } from "./messages.js";

export const AUTH_CREATE_ORGANIZATION_PATH = "/auth/create-organization";

const CREATE_ORGANIZATION_REDIRECT_TO_LOGIN_PATH = `/auth/login?redirectTo=${encodeURIComponent(
  AUTH_CREATE_ORGANIZATION_PATH,
)}`;

export function AuthCreateOrganizationPage(): React.JSX.Element {
  const sessionQuery = useSessionQuery();
  const location = useLocation();

  if (sessionQuery.isPending) {
    return <AuthCreateOrganizationPendingPage />;
  }

  if (sessionQuery.isError) {
    throw sessionQuery.error;
  }

  const session = sessionQuery.data;
  if (session === null) {
    return <Navigate replace to={CREATE_ORGANIZATION_REDIRECT_TO_LOGIN_PATH} />;
  }

  const activeOrganizationId = resolveActiveOrganizationIdFromSession(session);
  const canCancel = activeOrganizationId !== null;
  const cancelPath = resolveCreateOrganizationCancelPath(location.state);

  return (
    <AppearanceProvider appearance={readUserAppearanceFromSession(session)}>
      <AuthCreateOrganizationForm canCancel={canCancel} cancelPath={cancelPath} />
    </AppearanceProvider>
  );
}

function AuthCreateOrganizationPendingPage(): React.JSX.Element {
  return (
    <AuthPageShell maxWidthClass={AuthPageWidths.SM} title="Create an organization">
      <div className="flex justify-center py-2">
        <Spinner className="text-muted-foreground size-6" />
      </div>
    </AuthPageShell>
  );
}

function AuthCreateOrganizationForm(input: {
  canCancel: boolean;
  cancelPath: string;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [organizationName, setOrganizationName] = useState("");
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [createOrganizationError, setCreateOrganizationError] = useState<string | null>(null);

  const createOrganizationMutation = useMutation({
    mutationFn: async (name: string) => {
      const organization = await createOrganization({
        name,
        slug: createOrganizationCreateSlug(),
      });

      try {
        await switchActiveOrganization({
          organizationId: organization.id,
        });
      } catch {
        // The organization was created; session refresh can recover if the backend made it active.
      }
    },
    onSuccess: () => {
      setCreateOrganizationError(null);
      clearAuthenticatedSessionCache(queryClient);
      globalThis.location.replace(AUTH_SWITCH_ORGANIZATION_PATH);
    },
    onError: (error: unknown) => {
      setCreateOrganizationError(
        error instanceof Error ? error.message : "Unable to create organization.",
      );
    },
  });

  const signOutMutation = useMutation({
    mutationFn: async () => {
      const response = await authClient.signOut();
      if (response.error !== null) {
        throw new Error(resolveErrorMessage(response.error, "Unable to sign out."));
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: SESSION_QUERY_KEY,
      });
      await navigate("/auth/login", { replace: true });
    },
  });

  const onboardingValidation = resolveOrganizationOnboardingValidation({
    name: organizationName,
  });

  function handleOrganizationNameChange(value: string): void {
    setOrganizationName(value);
    setCreateOrganizationError(null);
  }

  function handleCreateOrganization(event: React.SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    setHasAttemptedSubmit(true);

    if (onboardingValidation.nameError !== null || createOrganizationMutation.isPending) {
      return;
    }

    createOrganizationMutation.mutate(organizationName.trim());
  }

  function handleCancel(): void {
    void navigate(input.cancelPath, { replace: true });
  }

  function handleSignOut(): void {
    signOutMutation.mutate();
  }

  return (
    <AuthPageShell maxWidthClass={AuthPageWidths.SM} title="Create an organization">
      <CreateOrganizationPageContent
        createOrganizationError={createOrganizationError}
        isCreatingOrganization={createOrganizationMutation.isPending}
        isSigningOut={signOutMutation.isPending}
        onCancel={input.canCancel ? handleCancel : null}
        onCreateOrganization={handleCreateOrganization}
        onOrganizationNameChange={handleOrganizationNameChange}
        onSignOut={input.canCancel ? null : handleSignOut}
        organizationName={organizationName}
        organizationNameError={resolveOrganizationOnboardingNameError({
          hasAttemptedSubmit,
          nameError: onboardingValidation.nameError,
        })}
      />
    </AuthPageShell>
  );
}

function resolveCreateOrganizationCancelPath(state: unknown): string {
  if (typeof state !== "object" || state === null) {
    return "/";
  }

  const from = Reflect.get(state, "from");
  if (typeof from !== "object" || from === null) {
    return "/";
  }

  const pathname = Reflect.get(from, "pathname");
  if (typeof pathname !== "string" || pathname.length === 0) {
    return "/";
  }

  const lowerPathname = pathname.toLowerCase();
  if (
    !pathname.startsWith("/") ||
    pathname.startsWith("//") ||
    lowerPathname.startsWith("/auth/")
  ) {
    return "/";
  }

  const search = Reflect.get(from, "search");
  const hash = Reflect.get(from, "hash");

  return `${pathname}${typeof search === "string" ? search : ""}${
    typeof hash === "string" ? hash : ""
  }`;
}
