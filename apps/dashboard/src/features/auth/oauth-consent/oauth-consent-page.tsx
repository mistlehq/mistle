import { Button, Spinner } from "@mistle/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useParams } from "react-router";

import { AuthPageShell, AuthPageWidths } from "../auth-page-shell.js";
import { ErrorNotice } from "../error-notice.js";
import {
  approveOAuthConsent,
  denyOAuthConsent,
  getOAuthConsentDetails,
} from "./oauth-consent-service.js";

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

  if (consentQuery.isPending) {
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

  return (
    <OAuthConsentForm
      clientName={consentQuery.data.clientName}
      key={requestId}
      organizationName={consentQuery.data.organizationName}
      requestId={requestId}
      requestedScopes={consentQuery.data.requestedScopes}
      resource={consentQuery.data.resource}
    />
  );
}

function OAuthConsentForm(input: {
  requestId: string;
  clientName: string;
  organizationName: string;
  resource: string;
  requestedScopes: readonly string[];
}): React.JSX.Element {
  const [selectedScopes, setSelectedScopes] = useState<Set<string>>(
    () => new Set(input.requestedScopes),
  );
  const selectedScopeList = useMemo(() => [...selectedScopes], [selectedScopes]);
  const approveMutation = useMutation({
    mutationFn: async () =>
      approveOAuthConsent({
        requestId: input.requestId,
        scopes: selectedScopeList,
      }),
    onSuccess: (redirectUri) => {
      globalThis.location.assign(redirectUri);
    },
  });
  const denyMutation = useMutation({
    mutationFn: async () => denyOAuthConsent({ requestId: input.requestId }),
    onSuccess: (redirectUri) => {
      globalThis.location.assign(redirectUri);
    },
  });
  const isSubmitting = approveMutation.isPending || denyMutation.isPending;

  return (
    <OAuthConsentPageView
      approveErrorMessage={approveMutation.isError ? approveMutation.error.message : null}
      clientName={input.clientName}
      denyErrorMessage={denyMutation.isError ? denyMutation.error.message : null}
      isSubmitting={isSubmitting}
      onApprove={() => approveMutation.mutate()}
      onDeny={() => denyMutation.mutate()}
      onSelectedScopesChange={setSelectedScopes}
      organizationName={input.organizationName}
      requestedScopes={input.requestedScopes}
      resource={input.resource}
      selectedScopes={selectedScopes}
    />
  );
}

export function OAuthConsentPageView(input: {
  clientName: string;
  organizationName: string;
  resource: string;
  requestedScopes: readonly string[];
  selectedScopes: ReadonlySet<string>;
  isSubmitting: boolean;
  approveErrorMessage: string | null;
  denyErrorMessage: string | null;
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
          <p className="text-muted-foreground break-all">{input.resource}</p>
        </div>

        <div className="gap-2 flex flex-col">
          {input.requestedScopes.map((scope) => (
            <label
              className="border-border bg-background gap-3 rounded-md border px-3 py-2 text-sm flex items-center"
              key={scope}
            >
              <input
                checked={input.selectedScopes.has(scope)}
                className="size-4"
                disabled={input.isSubmitting}
                onChange={(event) => {
                  const nextScopes = new Set(input.selectedScopes);
                  if (event.currentTarget.checked) {
                    nextScopes.add(scope);
                  } else {
                    nextScopes.delete(scope);
                  }
                  input.onSelectedScopesChange(nextScopes);
                }}
                type="checkbox"
              />
              <span>{scope}</span>
            </label>
          ))}
        </div>

        {input.approveErrorMessage === null ? null : (
          <ErrorNotice message={input.approveErrorMessage} />
        )}
        {input.denyErrorMessage === null ? null : <ErrorNotice message={input.denyErrorMessage} />}

        <div className="gap-2 justify-end flex">
          <Button
            disabled={input.isSubmitting}
            onClick={input.onDeny}
            type="button"
            variant="outline"
          >
            Deny
          </Button>
          <Button
            disabled={input.isSubmitting || input.selectedScopes.size === 0}
            onClick={input.onApprove}
            type="button"
          >
            Approve
          </Button>
        </div>
      </div>
    </AuthPageShell>
  );
}
