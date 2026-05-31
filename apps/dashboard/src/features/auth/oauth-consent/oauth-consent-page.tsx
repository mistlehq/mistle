import {
  Avatar,
  AvatarFallback,
  Button,
  Checkbox,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  Spinner,
} from "@mistle/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useParams } from "react-router";

import { deriveInitials } from "../../shared/derive-initials.js";
import { switchActiveOrganization } from "../../shell/organization-switcher.js";
import { AuthPageShell, AuthPageWidths } from "../auth-page-shell.js";
import { ErrorNotice } from "../error-notice.js";
import {
  approveOAuthConsent,
  denyOAuthConsent,
  getOAuthConsentDetails,
  getOAuthConsentOrganizations,
  type OAuthConsentOrganization,
} from "./oauth-consent-service.js";

type OAuthConsentSubmissionState = "editing" | "approving" | "denying" | "switchingOrganization";

const ScopeLabels: Record<string, string> = {
  "sandboxProfile:read": "Read sandbox profiles",
  "sandboxProfile:update": "Update sandbox profiles",
  "sandboxSession:create": "Create sandbox sessions",
  "sandboxSession:read": "Read sandbox sessions",
  "sandboxSession:connect": "Connect to sandbox sessions",
};

export function OAuthConsentPage(): React.JSX.Element {
  const { requestId } = useParams();
  if (requestId === undefined) {
    throw new Error("OAuth consent request id is required.");
  }

  const consentQuery = useQuery({
    queryKey: ["oauth-consent", requestId],
    queryFn: ({ signal }) => getOAuthConsentDetails({ requestId, signal }),
    retry: false,
  });
  const organizationsQuery = useQuery({
    queryKey: ["oauth-consent", requestId, "organizations"],
    queryFn: ({ signal }) => getOAuthConsentOrganizations({ signal }),
    retry: false,
  });

  if (consentQuery.isPending || organizationsQuery.isPending) {
    return (
      <AuthPageShell maxWidthClass={AuthPageWidths.LG} title="Authorize MCP access">
        <div className="justify-center py-2 flex">
          <Spinner className="text-muted-foreground size-6" />
        </div>
      </AuthPageShell>
    );
  }

  if (consentQuery.isError) {
    return (
      <AuthPageShell maxWidthClass={AuthPageWidths.LG} title="Authorize MCP access">
        <ErrorNotice message={consentQuery.error.message} />
      </AuthPageShell>
    );
  }
  if (organizationsQuery.isError) {
    return (
      <AuthPageShell maxWidthClass={AuthPageWidths.LG} title="Authorize MCP access">
        <ErrorNotice message={organizationsQuery.error.message} />
      </AuthPageShell>
    );
  }

  return (
    <OAuthConsentForm
      authorizationRestartUri={consentQuery.data.authorizationRestartUri}
      clientName={consentQuery.data.clientName}
      key={requestId}
      organizationName={consentQuery.data.organizationName}
      organizations={organizationsQuery.data}
      requestId={requestId}
      requestedScopes={consentQuery.data.requestedScopes}
    />
  );
}

function OAuthConsentForm(input: {
  requestId: string;
  clientName: string;
  organizationName: string;
  requestedScopes: readonly string[];
  organizations: readonly OAuthConsentOrganization[];
  authorizationRestartUri: string;
}): React.JSX.Element {
  const [selectedScopes, setSelectedScopes] = useState<Set<string>>(
    () => new Set(input.requestedScopes),
  );
  const [selectedOrganizationId, setSelectedOrganizationId] = useState(
    () => input.organizations.find((organization) => organization.isCurrent)?.id,
  );
  const [submissionState, setSubmissionState] = useState<OAuthConsentSubmissionState>("editing");
  const selectedScopeList = useMemo(() => [...selectedScopes], [selectedScopes]);
  const currentOrganization = input.organizations.find((organization) => organization.isCurrent);
  if (selectedOrganizationId === undefined || currentOrganization === undefined) {
    throw new Error("OAuth consent requires a current organization.");
  }
  const selectedOrganization = findOAuthConsentOrganization(
    input.organizations,
    selectedOrganizationId,
  );
  const organizationChanged = selectedOrganization.id !== currentOrganization.id;
  const approveMutation = useMutation({
    mutationFn: async () =>
      approveOAuthConsent({
        requestId: input.requestId,
        scopes: selectedScopeList,
      }),
    onSuccess: (redirectUri) => {
      globalThis.location.assign(redirectUri);
    },
    onError: () => {
      setSubmissionState("editing");
    },
  });
  const denyMutation = useMutation({
    mutationFn: async () => denyOAuthConsent({ requestId: input.requestId }),
    onSuccess: (redirectUri) => {
      globalThis.location.assign(redirectUri);
    },
    onError: () => {
      setSubmissionState("editing");
    },
  });
  const switchOrganizationMutation = useMutation({
    mutationFn: async () =>
      switchActiveOrganization({
        organizationId: selectedOrganization.id,
      }),
    onSuccess: () => {
      globalThis.location.assign(input.authorizationRestartUri);
    },
    onError: () => {
      setSubmissionState("editing");
    },
  });
  const isSubmitting =
    approveMutation.isPending || denyMutation.isPending || switchOrganizationMutation.isPending;

  return (
    <OAuthConsentPageView
      approveErrorMessage={approveMutation.isError ? approveMutation.error.message : null}
      clientName={input.clientName}
      denyErrorMessage={denyMutation.isError ? denyMutation.error.message : null}
      isSubmitting={isSubmitting}
      onApprove={() => {
        setSubmissionState("approving");
        approveMutation.mutate();
      }}
      onContinueWithSelectedOrganization={() => {
        setSubmissionState("switchingOrganization");
        switchOrganizationMutation.mutate();
      }}
      onDeny={() => {
        setSubmissionState("denying");
        denyMutation.mutate();
      }}
      onSelectedOrganizationChange={(organizationId) => {
        setSelectedOrganizationId(organizationId);
        setSubmissionState("editing");
      }}
      onSelectedScopesChange={(scopes) => {
        setSelectedScopes(scopes);
        setSubmissionState("editing");
      }}
      organizationName={input.organizationName}
      organizationChanged={organizationChanged}
      organizationErrorMessage={
        switchOrganizationMutation.isError ? switchOrganizationMutation.error.message : null
      }
      organizations={input.organizations}
      requestedScopes={input.requestedScopes}
      selectedOrganizationId={selectedOrganization.id}
      selectedScopes={selectedScopes}
      submissionState={submissionState}
    />
  );
}

export function OAuthConsentPageView(input: {
  clientName: string;
  organizationName: string;
  requestedScopes: readonly string[];
  selectedScopes: ReadonlySet<string>;
  organizations: readonly OAuthConsentOrganization[];
  selectedOrganizationId: string;
  organizationChanged: boolean;
  isSubmitting: boolean;
  submissionState: OAuthConsentSubmissionState;
  approveErrorMessage: string | null;
  denyErrorMessage: string | null;
  organizationErrorMessage: string | null;
  onSelectedOrganizationChange: (organizationId: string) => void;
  onContinueWithSelectedOrganization: () => void;
  onSelectedScopesChange: (scopes: Set<string>) => void;
  onApprove: () => void;
  onDeny: () => void;
}): React.JSX.Element {
  return (
    <AuthPageShell maxWidthClass={AuthPageWidths.LG} title="Authorize MCP access">
      <div className="gap-5 flex flex-col">
        <div className="gap-2 text-sm flex flex-col">
          <p className="text-foreground">
            {input.clientName} is requesting access to {input.organizationName}.
          </p>
        </div>

        <section className="gap-3 flex flex-col">
          <div>
            <h2 className="text-sm font-medium">Organization</h2>
          </div>
          <Select
            disabled={input.isSubmitting}
            onValueChange={(organizationId) => {
              if (organizationId === null) {
                throw new Error("OAuth consent organization selection is required.");
              }

              input.onSelectedOrganizationChange(organizationId);
            }}
            value={input.selectedOrganizationId}
          >
            <SelectTrigger className="h-auto min-h-16 w-full px-3 py-3.5">
              <OAuthConsentOrganizationOption
                organization={findOAuthConsentOrganization(
                  input.organizations,
                  input.selectedOrganizationId,
                )}
              />
            </SelectTrigger>
            <SelectContent align="start" className="w-(--anchor-width)">
              {input.organizations.map((organization) => (
                <SelectItem className="px-3 py-3" key={organization.id} value={organization.id}>
                  <OAuthConsentOrganizationOption organization={organization} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {input.organizationChanged ? (
            <div className="gap-3 rounded-md border bg-muted/30 p-3 flex items-center justify-between">
              <p className="text-muted-foreground text-sm">
                Changing organizations will restart this authorization request.
              </p>
              <Button
                disabled={input.isSubmitting}
                onClick={input.onContinueWithSelectedOrganization}
                size="sm"
                type="button"
              >
                {input.submissionState === "switchingOrganization" ? "Continuing..." : "Continue"}
              </Button>
            </div>
          ) : null}
        </section>

        <section className="gap-3 flex flex-col">
          <div>
            <h2 className="text-sm font-medium">Scopes</h2>
          </div>
          <div className="gap-2 flex flex-col">
            {input.requestedScopes.map((scope) => (
              <div
                className="gap-3 rounded-md border bg-background p-3 text-sm flex items-center"
                key={scope}
              >
                <Checkbox
                  checked={input.selectedScopes.has(scope)}
                  className="size-5 shrink-0 border-muted-foreground/60 data-checked:border-primary"
                  disabled={input.isSubmitting || input.organizationChanged}
                  id={`oauth-consent-scope-${scope}`}
                  onCheckedChange={(checked) => {
                    const nextScopes = new Set(input.selectedScopes);
                    if (checked === true) {
                      nextScopes.add(scope);
                    } else {
                      nextScopes.delete(scope);
                    }
                    input.onSelectedScopesChange(nextScopes);
                  }}
                />
                <label className="min-w-0 cursor-pointer" htmlFor={`oauth-consent-scope-${scope}`}>
                  <span>{formatScopeLabel(scope)}</span>
                </label>
              </div>
            ))}
          </div>
        </section>

        {input.approveErrorMessage === null ? null : (
          <ErrorNotice message={input.approveErrorMessage} />
        )}
        {input.denyErrorMessage === null ? null : <ErrorNotice message={input.denyErrorMessage} />}
        {input.organizationErrorMessage === null ? null : (
          <ErrorNotice message={input.organizationErrorMessage} />
        )}

        <div className="gap-2 justify-end flex">
          <Button
            disabled={input.isSubmitting}
            onClick={input.onDeny}
            type="button"
            variant="outline"
          >
            {input.submissionState === "denying" ? "Denying..." : "Deny"}
          </Button>
          <Button
            disabled={
              input.isSubmitting || input.organizationChanged || input.selectedScopes.size === 0
            }
            onClick={input.onApprove}
            type="button"
          >
            {input.submissionState === "approving" ? "Approving..." : "Approve"}
          </Button>
        </div>
      </div>
    </AuthPageShell>
  );
}

function OAuthConsentOrganizationOption(input: {
  organization: OAuthConsentOrganization;
}): React.JSX.Element {
  return (
    <span className="min-w-0 gap-3 text-left flex items-center">
      <Avatar className="size-10 shrink-0">
        <AvatarFallback>
          {deriveInitials({ name: input.organization.name, fallback: "O" })}
        </AvatarFallback>
      </Avatar>
      <span className="min-w-0 gap-0.5 flex flex-1 flex-col">
        <span className="block truncate font-medium leading-5">{input.organization.name}</span>
        <span className="text-muted-foreground block truncate leading-5">
          {formatOrganizationRole(input.organization.role)}
        </span>
      </span>
    </span>
  );
}

function findOAuthConsentOrganization(
  organizations: readonly OAuthConsentOrganization[],
  organizationId: string,
): OAuthConsentOrganization {
  const organization = organizations.find((item) => item.id === organizationId);
  if (organization === undefined) {
    throw new Error(`OAuth consent organization '${organizationId}' is not available.`);
  }

  return organization;
}

function formatScopeLabel(scope: string): string {
  return ScopeLabels[scope] ?? scope;
}

function formatOrganizationRole(role: string): string {
  if (role === "owner") {
    return "Owner";
  }
  if (role === "admin") {
    return "Admin";
  }
  if (role === "member") {
    return "Member";
  }
  return role;
}
