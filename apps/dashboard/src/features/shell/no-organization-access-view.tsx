import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { authClient } from "../../lib/auth/client.js";
import { useAuthMethodsQuery } from "../auth/auth-methods-query.js";
import { AuthPageShell, AuthPageWidths } from "../auth/auth-page-shell.js";
import { ErrorNotice } from "../auth/error-notice.js";
import { resolveErrorMessage } from "../auth/messages.js";
import { NoOrganizationAccessViewContent } from "./no-organization-access-view-content.js";
import {
  createOrganizationCreateSlug,
  resolveOrganizationOnboardingNameError,
  resolveOrganizationOnboardingValidation,
} from "./organization-onboarding.js";
import { PendingSessionShell } from "./pending-session-shell.js";
import { requireAuthenticatedSession } from "./session-context.js";
import { SESSION_QUERY_KEY, useSessionQuery } from "./session-query.js";

export function NoOrganizationAccessView(): React.JSX.Element {
  const sessionQuery = useSessionQuery();
  const authMethodsQuery = useAuthMethodsQuery();
  const queryClient = useQueryClient();
  requireAuthenticatedSession(sessionQuery.data ?? null);
  const [organizationName, setOrganizationName] = useState("");
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [createOrganizationError, setCreateOrganizationError] = useState<string | null>(null);

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

  const createOrganizationMutation = useMutation({
    mutationFn: async (input: { name: string }) => {
      const response = await authClient.organization.create({
        name: input.name,
        slug: createOrganizationCreateSlug(),
      });
      if (response.error !== null) {
        throw new Error(resolveErrorMessage(response.error, "Unable to create organization."));
      }
    },
    onSuccess: async () => {
      setCreateOrganizationError(null);
      await queryClient.invalidateQueries({
        queryKey: SESSION_QUERY_KEY,
      });
    },
    onError: (error: unknown) => {
      setCreateOrganizationError(
        error instanceof Error ? error.message : "Unable to create organization.",
      );
    },
  });

  const onboardingValidation = resolveOrganizationOnboardingValidation({
    name: organizationName,
  });

  function handleSignOut(): void {
    signOutMutation.mutate();
  }

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

    createOrganizationMutation.mutate({
      name: organizationName.trim(),
    });
  }

  if (authMethodsQuery.isPending) {
    return <PendingSessionShell />;
  }

  if (authMethodsQuery.isError) {
    return (
      <AuthPageShell maxWidthClass={AuthPageWidths.SM} title="Organization unavailable">
        <ErrorNotice message={authMethodsQuery.error.message} />
      </AuthPageShell>
    );
  }

  const canCreateOrganization = authMethodsQuery.data.organization.selfServiceCreationEnabled;
  const title = canCreateOrganization ? "Create an organization" : "Organization access";

  return (
    <AuthPageShell maxWidthClass={AuthPageWidths.SM} title={title}>
      <NoOrganizationAccessViewContent
        canCreateOrganization={canCreateOrganization}
        createOrganizationError={createOrganizationError}
        isCreatingOrganization={createOrganizationMutation.isPending}
        isSigningOut={signOutMutation.isPending}
        onCreateOrganization={handleCreateOrganization}
        onOrganizationNameChange={handleOrganizationNameChange}
        onSignOut={handleSignOut}
        organizationName={organizationName}
        organizationNameError={resolveOrganizationOnboardingNameError({
          hasAttemptedSubmit,
          nameError: onboardingValidation.nameError,
        })}
      />
    </AuthPageShell>
  );
}
