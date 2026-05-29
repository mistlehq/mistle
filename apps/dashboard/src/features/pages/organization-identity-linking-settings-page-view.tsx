import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Notice,
  ScrollArea,
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
  canOpenLinkedUsers: boolean;
  displayName: string;
  logoKey: string;
  connectionLabel: string;
  enablePending: boolean;
  enabled: boolean;
  unavailableMessage: string | null;
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

export type GitCommitSigningImpactConfirmation = {
  action: "enable" | "disable";
  connectionLabel: string;
  providerDisplayName: string;
  updatedProfileCount: number;
  invariantViolationCount: number;
  pending: boolean;
};

export type OrganizationIdentityLinkingSettingsPageViewProps = {
  loadErrorMessage: string | null;
  providers: readonly OrganizationIdentityLinkingProviderRow[];
  gitCommitSigningImpactConfirmation: GitCommitSigningImpactConfirmation | null;
  onCancelGitCommitSigningImpactConfirmation: () => void;
  onConfirmGitCommitSigningImpactConfirmation: () => Promise<void> | void;
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
      <FormPageStack className="w-full min-w-0">
        <ResponsiveFieldList
          className="w-full min-w-0 border-y bg-card"
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
      <GitCommitSigningImpactConfirmationDialog
        confirmation={props.gitCommitSigningImpactConfirmation}
        onCancel={props.onCancelGitCommitSigningImpactConfirmation}
        onConfirm={props.onConfirmGitCommitSigningImpactConfirmation}
      />
    </>
  );
}

function IdentityLinkingProviderRowView(input: {
  provider: OrganizationIdentityLinkingProviderRow;
  isLastRow: boolean;
  onEnabledChange: OrganizationIdentityLinkingSettingsPageViewProps["onEnabledChange"];
  onOpenLinkedUsers: () => void;
}): React.JSX.Element {
  const provider = input.provider;
  const canOpenLinkedUsers = provider.canOpenLinkedUsers;

  return (
    <ResponsiveFieldListRow
      className="px-4 py-4"
      isLastRow={input.isLastRow}
      status={provider.enablePending ? "Saving..." : provider.unavailableMessage}
      statusClassName={
        provider.unavailableMessage === null || provider.enablePending
          ? "pt-4"
          : "pt-4 text-warning-foreground"
      }
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
          </div>
        </div>
      </ResponsiveFieldListCell>

      <ResponsiveFieldListCell columnKey="connection">
        <div className="truncate text-sm">{provider.connectionLabel}</div>
      </ResponsiveFieldListCell>

      <ResponsiveFieldListCell columnKey="linkedUsers">
        <div className="inline-flex items-center gap-2.5 md:justify-center">
          {provider.linkedUsersCount === null ? (
            <span className="text-sm text-muted-foreground">-</span>
          ) : (
            <span className="text-sm">{String(provider.linkedUsersCount)}</span>
          )}
          {canOpenLinkedUsers ? (
            <Button
              aria-label={`View ${provider.displayName} linked users for ${provider.connectionLabel}`}
              className="h-auto w-auto p-0 hover:bg-transparent"
              onClick={input.onOpenLinkedUsers}
              type="button"
              variant="ghost"
            >
              <EyeIcon />
            </Button>
          ) : null}
        </div>
      </ResponsiveFieldListCell>

      <ResponsiveFieldListCell columnKey="enable">
        <Switch
          aria-label={`Enable ${provider.displayName} identity linking for ${provider.connectionLabel}`}
          checked={provider.enabled}
          disabled={
            provider.enablePending || (provider.unavailableMessage !== null && !provider.enabled)
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

function GitCommitSigningImpactConfirmationDialog(input: {
  confirmation: GitCommitSigningImpactConfirmation | null;
  onCancel: () => void;
  onConfirm: () => Promise<void> | void;
}): React.JSX.Element {
  const confirmation = input.confirmation;
  const title =
    confirmation === null
      ? "Enable identity linking?"
      : confirmation.action === "disable"
        ? `Disable ${confirmation.providerDisplayName} identity linking?`
        : `Enable ${confirmation.providerDisplayName} identity linking?`;
  const confirmLabel =
    confirmation?.action === "disable" ? "Disable identity linking" : "Enable identity linking";

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && confirmation?.pending !== true) {
          input.onCancel();
        }
      }}
      open={confirmation !== null}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader variant="sectioned">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {confirmation === null ? null : (
          <div className="flex flex-col gap-3 text-sm text-muted-foreground">
            {confirmation.updatedProfileCount === 0 ? null : (
              <p>
                {formatGitCommitSigningImpactSentence({
                  action: confirmation.action,
                  connectionLabel: confirmation.connectionLabel,
                  updatedProfileCount: confirmation.updatedProfileCount,
                })}
              </p>
            )}
            {confirmation.invariantViolationCount === 0 ? null : (
              <Notice variant="warning">
                Some sandbox profiles have inconsistent commit signing state and will not be
                updated.
              </Notice>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            disabled={confirmation?.pending === true}
            onClick={input.onCancel}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={confirmation?.pending === true}
            onClick={() => {
              void input.onConfirm();
            }}
            type="button"
            variant={confirmation?.action === "disable" ? "destructive" : "default"}
          >
            {confirmation?.pending === true ? "Saving..." : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatGitCommitSigningImpactSentence(input: {
  action: "enable" | "disable";
  connectionLabel: string;
  updatedProfileCount: number;
}): string {
  const profileCountText =
    input.updatedProfileCount === 1
      ? "1 sandbox profile"
      : `${String(input.updatedProfileCount)} sandbox profiles`;
  const actionText = input.action === "enable" ? "enabled" : "disabled";

  return `Commit signing will be ${actionText} for ${profileCountText} using ${input.connectionLabel}.`;
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
            {provider === null
              ? "Linked users"
              : `${provider.displayName} linked users for ${provider.connectionLabel}`}
          </DialogTitle>
        </DialogHeader>

        {provider === null ? null : provider.memberLinksErrorMessage !== null ? (
          <Notice variant="alert">{provider.memberLinksErrorMessage}</Notice>
        ) : !provider.canOpenLinkedUsers ? (
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
