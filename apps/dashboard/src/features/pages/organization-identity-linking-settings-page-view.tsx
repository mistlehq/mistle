import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Notice,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@mistle/ui";
import { EyeIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { IntegrationLogo } from "../integrations/integration-logo.js";
import { FormPageStack } from "../shared/form-page.js";
import {
  ResponsiveFieldList,
  ResponsiveFieldListCell,
  type ResponsiveFieldListColumn,
  ResponsiveFieldListRow,
} from "../shared/responsive-field-list.js";

export type OrganizationIdentityLinkingProviderRow = {
  rowKey: string;
  providerFamily: string;
  organizationProviderConfigId: string | null;
  displayName: string;
  configurationLabel?: string | null;
  logoKey: string;
  connectionOptions: readonly {
    id: string;
    label: string;
  }[];
  selectedConnectionId: string | null;
  connectionPending: boolean;
  enablePending: boolean;
  enabled: boolean;
  linkedUsersCount: number | null;
  memberLinksErrorMessage: string | null;
  memberLinks: readonly {
    userId: string;
    name: string;
    email: string;
    statusLabel: string;
    principalSummary: string | null;
    updatedAt: string | null;
  }[];
};

export type OrganizationIdentityLinkingSettingsPageViewProps = {
  loadErrorMessage: string | null;
  providers: readonly OrganizationIdentityLinkingProviderRow[];
  onProviderConnectionChange: (input: {
    rowKey: string;
    integrationConnectionId: string;
  }) => Promise<void> | void;
  onEnabledChange: (input: { rowKey: string; enabled: boolean }) => Promise<void> | void;
};

const IdentityLinkingProviderColumns = [
  { key: "integration", label: "Integration", desktopWidth: "minmax(0,1.1fr)" },
  { key: "connection", label: "Connection", desktopWidth: "minmax(0,1.6fr)" },
  { key: "linkedUsers", label: "Linked Users", desktopWidth: "180px", align: "center" },
  { key: "enable", label: "Enable", desktopWidth: "88px", align: "center" },
] satisfies readonly ResponsiveFieldListColumn[];

export function OrganizationIdentityLinkingSettingsPageView(
  props: OrganizationIdentityLinkingSettingsPageViewProps,
): React.JSX.Element {
  const [linkedUsersDialogRowKey, setLinkedUsersDialogRowKey] = useState<string | null>(null);

  const linkedUsersDialogProvider =
    linkedUsersDialogRowKey === null
      ? null
      : (props.providers.find((provider) => provider.rowKey === linkedUsersDialogRowKey) ?? null);

  if (props.loadErrorMessage !== null) {
    return (
      <FormPageStack>
        <div className="flex flex-col gap-3">
          <Notice variant="alert">{props.loadErrorMessage} Please try again later.</Notice>
        </div>
      </FormPageStack>
    );
  }

  if (props.providers.length === 0) {
    return (
      <FormPageStack>
        <div className="flex flex-col gap-3">
          <Notice>
            No identity-linking providers are currently available for this environment.
          </Notice>
        </div>
      </FormPageStack>
    );
  }

  return (
    <>
      <FormPageStack>
        <ResponsiveFieldList
          className="border-y bg-card"
          columns={IdentityLinkingProviderColumns}
          headerClassName="px-4 py-3 font-medium"
        >
          {props.providers.map((provider, index) => (
            <IdentityLinkingProviderRowView
              key={provider.rowKey}
              isLastRow={index === props.providers.length - 1}
              onEnabledChange={props.onEnabledChange}
              onOpenLinkedUsers={() => {
                setLinkedUsersDialogRowKey(provider.rowKey);
              }}
              onProviderConnectionChange={props.onProviderConnectionChange}
              provider={provider}
            />
          ))}
        </ResponsiveFieldList>
      </FormPageStack>

      <LinkedUsersDialog
        onOpenChange={(open) => {
          if (!open) {
            setLinkedUsersDialogRowKey(null);
          }
        }}
        provider={linkedUsersDialogProvider}
      />
    </>
  );
}

function IdentityLinkingProviderRowView(input: {
  provider: OrganizationIdentityLinkingProviderRow;
  isLastRow: boolean;
  onProviderConnectionChange: OrganizationIdentityLinkingSettingsPageViewProps["onProviderConnectionChange"];
  onEnabledChange: OrganizationIdentityLinkingSettingsPageViewProps["onEnabledChange"];
  onOpenLinkedUsers: () => void;
}): React.JSX.Element {
  const provider = input.provider;
  const selectedConnectionLabel = resolveSelectedConnectionLabel(provider);
  const hasEligibleConnections = provider.connectionOptions.length > 0;
  const rowStatusMessage = provider.connectionPending ? "Saving connection..." : null;

  return (
    <ResponsiveFieldListRow
      className="px-4 py-4"
      isLastRow={input.isLastRow}
      status={rowStatusMessage}
      statusClassName="pt-4"
    >
      <ResponsiveFieldListCell columnKey="integration">
        <div className="flex min-w-0 items-center gap-3">
          <IntegrationLogo
            alt={`${provider.displayName} logo`}
            className="h-9 w-9 rounded-md border bg-background p-1.5"
            logoKey={provider.logoKey}
          />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{provider.displayName}</div>
            {provider.configurationLabel === null ? null : (
              <div className="truncate text-xs text-muted-foreground">
                {provider.configurationLabel}
              </div>
            )}
          </div>
        </div>
      </ResponsiveFieldListCell>

      <ResponsiveFieldListCell columnKey="connection">
        {hasEligibleConnections ? (
          <Select
            onValueChange={(integrationConnectionId) => {
              if (integrationConnectionId === null || integrationConnectionId.length === 0) {
                return;
              }

              void input.onProviderConnectionChange({
                rowKey: provider.rowKey,
                integrationConnectionId,
              });
            }}
            value={provider.selectedConnectionId ?? ""}
          >
            <SelectTrigger
              aria-label={`${provider.displayName} connection`}
              className="w-full md:max-w-xl"
              disabled={provider.connectionPending}
            >
              <SelectValue placeholder={`Select ${provider.displayName} connection`}>
                {selectedConnectionLabel}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {provider.connectionOptions.map((connection) => (
                <SelectItem key={connection.id} value={connection.id}>
                  {connection.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
            No eligible active connections
          </div>
        )}
      </ResponsiveFieldListCell>

      <ResponsiveFieldListCell columnKey="linkedUsers">
        <div className="inline-flex items-center gap-2.5 md:justify-center">
          {provider.linkedUsersCount === null ? null : (
            <span className="text-sm">{String(provider.linkedUsersCount)}</span>
          )}
          <Button
            aria-label={`View ${provider.displayName} linked users`}
            className="h-auto w-auto p-0 hover:bg-transparent"
            onClick={input.onOpenLinkedUsers}
            type="button"
            variant="ghost"
          >
            <EyeIcon />
          </Button>
        </div>
      </ResponsiveFieldListCell>

      <ResponsiveFieldListCell columnKey="enable">
        <Switch
          aria-label={`Enable ${provider.displayName} identity linking`}
          checked={provider.enabled}
          disabled={
            provider.enablePending ||
            provider.connectionPending ||
            provider.selectedConnectionId === null
          }
          onCheckedChange={(enabled) => {
            void input.onEnabledChange({
              rowKey: provider.rowKey,
              enabled,
            });
          }}
        />
      </ResponsiveFieldListCell>
    </ResponsiveFieldListRow>
  );
}

function LinkedUsersDialog(input: {
  provider: OrganizationIdentityLinkingProviderRow | null;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const [lastProvider, setLastProvider] = useState<OrganizationIdentityLinkingProviderRow | null>(
    null,
  );
  const provider = input.provider ?? lastProvider;

  useEffect(() => {
    if (input.provider !== null) {
      setLastProvider(input.provider);
    }
  }, [input.provider]);

  return (
    <Dialog onOpenChange={input.onOpenChange} open={input.provider !== null}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader variant="sectioned">
          <DialogTitle>
            {provider === null ? "Linked users" : `${provider.displayName} linked users`}
          </DialogTitle>
        </DialogHeader>

        {provider === null ? null : provider.memberLinksErrorMessage !== null ? (
          <Notice variant="alert">{provider.memberLinksErrorMessage}</Notice>
        ) : provider.organizationProviderConfigId === null ? (
          <Notice>No linked users.</Notice>
        ) : provider.linkedUsersCount === null ? null : provider.memberLinks.length === 0 ? (
          <Notice>No linked users.</Notice>
        ) : (
          <ScrollArea className="max-h-96 rounded-md border">
            <div className="flex flex-col divide-y">
              {provider.memberLinks.map((memberLink) => (
                <div
                  className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                  key={memberLink.userId}
                >
                  <div className="min-w-0">
                    <div className="font-medium">{memberLink.name}</div>
                    <div className="text-sm text-muted-foreground">{memberLink.email}</div>
                    {memberLink.principalSummary === null ? null : (
                      <div className="text-sm text-muted-foreground">
                        {memberLink.principalSummary}
                      </div>
                    )}
                    {memberLink.updatedAt === null ? null : (
                      <div className="text-sm text-muted-foreground">
                        Updated {memberLink.updatedAt}
                      </div>
                    )}
                  </div>
                  <Badge variant="outline">{memberLink.statusLabel}</Badge>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}

function resolveSelectedConnectionLabel(
  provider: Pick<
    OrganizationIdentityLinkingProviderRow,
    "connectionOptions" | "selectedConnectionId"
  >,
): string | undefined {
  if (provider.selectedConnectionId === null) {
    return undefined;
  }

  return provider.connectionOptions.find(
    (connection) => connection.id === provider.selectedConnectionId,
  )?.label;
}
