import {
  Badge,
  Button,
  Notice,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@mistle/ui";
import { Link } from "react-router";

import { resolveIntegrationLogoPath } from "../integrations/logo.js";
import { FormPageSection, FormPageStack } from "../shared/form-page.js";

export type OrganizationIdentityLinkingProviderCard = {
  providerFamily: string;
  displayName: string;
  logoKey: string;
  configurationStatusLabel: string;
  configurationStatusTone: "active" | "disabled" | "unconfigured";
  eligibleConnections: readonly {
    id: string;
    label: string;
  }[];
  selectedConnectionId: string | null;
  configureActionLabel: string;
  statusActionLabel: string;
  statusActionNextStatus: "active" | "disabled";
  addConnectionOptions: readonly {
    href: string;
    label: string;
  }[];
  statusActionVisible: boolean;
  statusActionDisabled: boolean;
  saveActionDisabled: boolean;
  saveActionPending: boolean;
  statusActionPending: boolean;
  errorMessage?: string;
};

export type OrganizationIdentityLinkingSettingsPageViewProps = {
  loadErrorMessage: string | null;
  providers: readonly OrganizationIdentityLinkingProviderCard[];
  onProviderConnectionChange: (input: {
    providerFamily: string;
    integrationConnectionId: string;
  }) => void;
  onSaveProvider: (input: {
    providerFamily: string;
    integrationConnectionId: string;
  }) => Promise<void> | void;
  onStatusAction: (input: {
    providerFamily: string;
    status: "active" | "disabled";
  }) => Promise<void> | void;
};

export function OrganizationIdentityLinkingSettingsPageView(
  props: OrganizationIdentityLinkingSettingsPageViewProps,
): React.JSX.Element {
  if (props.loadErrorMessage !== null) {
    return (
      <FormPageStack>
        <FormPageSection>
          <div className="flex flex-col gap-3 p-4">
            <Notice variant="alert">{props.loadErrorMessage} Please try again later.</Notice>
          </div>
        </FormPageSection>
      </FormPageStack>
    );
  }

  if (props.providers.length === 0) {
    return (
      <FormPageStack>
        <FormPageSection>
          <div className="flex flex-col gap-3 p-4">
            <Notice>
              No identity-linking providers are currently available for this environment.
            </Notice>
          </div>
        </FormPageSection>
      </FormPageStack>
    );
  }

  return (
    <FormPageStack>
      {props.providers.map((provider) => (
        <FormPageSection key={provider.providerFamily}>
          <div className="flex flex-col gap-4 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <img
                  alt={`${provider.displayName} logo`}
                  className="h-10 w-10 rounded-md border bg-background p-1.5"
                  src={resolveIntegrationLogoPath({ logoKey: provider.logoKey })}
                />
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold leading-tight">{provider.displayName}</h2>
                  <StatusBadge tone={provider.configurationStatusTone}>
                    {provider.configurationStatusLabel}
                  </StatusBadge>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {provider.addConnectionOptions.map((option) => (
                  <Button
                    key={option.href}
                    render={<Link to={option.href} />}
                    type="button"
                    variant="outline"
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label
                className="text-sm font-medium"
                htmlFor={`identity-link-provider-${provider.providerFamily}`}
              >
                Connection
              </label>
              {provider.eligibleConnections.length === 0 ? (
                <Notice>No eligible active connections yet. Connect a new one first.</Notice>
              ) : (
                <Select
                  onValueChange={(integrationConnectionId) => {
                    if (integrationConnectionId === null || integrationConnectionId.length === 0) {
                      return;
                    }

                    props.onProviderConnectionChange({
                      providerFamily: provider.providerFamily,
                      integrationConnectionId,
                    });
                  }}
                  value={provider.selectedConnectionId ?? ""}
                >
                  <SelectTrigger
                    aria-label={`Select approved ${provider.displayName} connection`}
                    id={`identity-link-provider-${provider.providerFamily}`}
                    className="w-full max-w-xl"
                  >
                    <SelectValue placeholder={`Select a ${provider.displayName} connection`}>
                      {resolveSelectedConnectionLabel(provider)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    {provider.eligibleConnections.map((connection) => (
                      <SelectItem key={connection.id} value={connection.id}>
                        {connection.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {provider.errorMessage === undefined ? null : (
              <Notice variant="alert">{provider.errorMessage}</Notice>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                disabled={provider.saveActionDisabled}
                onClick={() => {
                  if (provider.selectedConnectionId === null) {
                    return;
                  }

                  void props.onSaveProvider({
                    providerFamily: provider.providerFamily,
                    integrationConnectionId: provider.selectedConnectionId,
                  });
                }}
                type="button"
              >
                {provider.saveActionPending ? "Saving..." : provider.configureActionLabel}
              </Button>
              {provider.statusActionVisible ? (
                <Button
                  disabled={provider.statusActionDisabled}
                  onClick={() => {
                    void props.onStatusAction({
                      providerFamily: provider.providerFamily,
                      status: provider.statusActionNextStatus,
                    });
                  }}
                  type="button"
                  variant="outline"
                >
                  {provider.statusActionPending ? "Saving..." : provider.statusActionLabel}
                </Button>
              ) : null}
            </div>
          </div>
        </FormPageSection>
      ))}
    </FormPageStack>
  );
}

function resolveSelectedConnectionLabel(
  provider: Pick<
    OrganizationIdentityLinkingProviderCard,
    "eligibleConnections" | "selectedConnectionId"
  >,
): string | undefined {
  if (provider.selectedConnectionId === null) {
    return undefined;
  }

  return provider.eligibleConnections.find(
    (connection) => connection.id === provider.selectedConnectionId,
  )?.label;
}

function StatusBadge(input: {
  children: React.ReactNode;
  tone: "active" | "disabled" | "unconfigured";
}): React.JSX.Element {
  const className =
    input.tone === "active"
      ? "border-emerald-600/30 bg-emerald-600/10 text-emerald-700"
      : input.tone === "disabled"
        ? "border-amber-600/30 bg-amber-600/10 text-amber-700"
        : "border";

  return (
    <Badge className={className} variant="outline">
      {input.children}
    </Badge>
  );
}
