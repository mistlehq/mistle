import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Notice,
  ScrollArea,
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@mistle/ui";
import { EyeIcon, XIcon } from "@phosphor-icons/react";
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
  canOpenMemberLinkStatus: boolean;
  displayName: string;
  logoKey: string;
  connectionLabel: string;
  enablePending: boolean;
  enabled: boolean;
  unavailableMessage: string | null;
  memberLinkStatusCounts: {
    linked: number;
    total: number;
  } | null;
  memberLinksErrorMessage: string | null;
  memberLinks: readonly {
    userId: string;
    name: string;
    email: string;
    linked: boolean;
    statusLabel: string;
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
  { key: "memberLinks", label: "Users Linked", desktopWidth: "220px", align: "center" },
  { key: "enable", label: "Enable", desktopWidth: "88px", align: "center" },
] satisfies readonly ResponsiveFieldListColumn[];

type LinkStatusFilter = "all" | "linked" | "not-linked";

type LoadedMemberLinkStatusProvider = OrganizationIdentityLinkingProviderRow & {
  memberLinkStatusCounts: {
    linked: number;
    total: number;
  };
};

export function OrganizationIdentityLinkingSettingsPageView(
  props: OrganizationIdentityLinkingSettingsPageViewProps,
): React.JSX.Element {
  const [memberLinkStatusSheetRowKey, setMemberLinkStatusSheetRowKey] = useState<string | null>(
    null,
  );

  const memberLinkStatusSheetProvider =
    memberLinkStatusSheetRowKey === null
      ? null
      : (props.providers.find((provider) => provider.rowKey === memberLinkStatusSheetRowKey) ??
        null);

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
              onOpenMemberLinkStatus={() => {
                setMemberLinkStatusSheetRowKey(provider.rowKey);
              }}
              provider={provider}
            />
          ))}
        </ResponsiveFieldList>
      </FormPageStack>

      <MemberLinkStatusSheet
        onOpenChange={(open) => {
          if (!open) {
            setMemberLinkStatusSheetRowKey(null);
          }
        }}
        provider={memberLinkStatusSheetProvider}
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
  onOpenMemberLinkStatus: () => void;
}): React.JSX.Element {
  const provider = input.provider;
  const canOpenMemberLinkStatus = provider.canOpenMemberLinkStatus;

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

      <ResponsiveFieldListCell columnKey="memberLinks">
        <div className="inline-flex items-center gap-2.5 md:justify-center">
          {provider.memberLinkStatusCounts === null ? (
            <span className="text-sm text-muted-foreground">-</span>
          ) : (
            <span className="text-sm">
              {formatMemberLinkStatusCounts(provider.memberLinkStatusCounts)}
            </span>
          )}
          {canOpenMemberLinkStatus ? (
            <Button
              aria-label={`View ${provider.displayName} link status for ${provider.connectionLabel}`}
              className="h-auto w-auto p-0 hover:bg-transparent"
              onClick={input.onOpenMemberLinkStatus}
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

function formatMemberLinkStatusCounts(input: { linked: number; total: number }): string {
  return `${String(input.linked)} linked out of ${String(input.total)}`;
}

function MemberLinkStatusSheet(input: {
  provider: OrganizationIdentityLinkingProviderRow | null;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const [lastProvider, setLastProvider] = useState<OrganizationIdentityLinkingProviderRow | null>(
    null,
  );
  const [activeFilter, setActiveFilter] = useState<LinkStatusFilter>("all");
  const [activeFilterRowKey, setActiveFilterRowKey] = useState<string | null>(null);
  const provider = input.provider ?? lastProvider;
  const openProviderRowKey = input.provider?.rowKey ?? null;

  useEffect(() => {
    if (input.provider !== null) {
      setLastProvider(input.provider);
    }
  }, [input.provider]);

  useEffect(() => {
    if (openProviderRowKey !== activeFilterRowKey) {
      setActiveFilterRowKey(openProviderRowKey);
      if (openProviderRowKey !== null) {
        setActiveFilter("all");
      }
    }
  }, [activeFilterRowKey, openProviderRowKey]);

  const visibleMemberLinks =
    provider === null ? [] : filterMemberLinks(provider.memberLinks, activeFilter);
  const showStatusFilters =
    provider !== null &&
    provider.memberLinksErrorMessage === null &&
    provider.canOpenMemberLinkStatus &&
    hasLoadedMemberLinkStatus(provider) &&
    provider.memberLinks.length > 0;

  return (
    <Sheet onOpenChange={input.onOpenChange} open={input.provider !== null}>
      <SheetContent
        className="!left-0 !right-0 !h-[100dvh] !w-auto max-w-none !border-t-0 max-h-[100dvh] gap-0 overflow-hidden p-0"
        showCloseButton={false}
        side="bottom"
      >
        <SheetHeader className="shrink-0 border-b px-4 py-3 text-left">
          <div className="flex min-h-8 items-center justify-between gap-3">
            <SheetTitle className="min-w-0 truncate">
              {provider === null ? "Link Status" : `Link Status for ${provider.connectionLabel}`}
            </SheetTitle>
            <SheetClose
              render={
                <Button
                  aria-label="Close"
                  className="-mr-2 shrink-0"
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                />
              }
            >
              <XIcon />
              <span className="sr-only">Close</span>
            </SheetClose>
          </div>

          {showStatusFilters ? (
            <Tabs
              onValueChange={(nextValue) => {
                if (isLinkStatusFilter(nextValue)) {
                  setActiveFilter(nextValue);
                }
              }}
              value={activeFilter}
            >
              <TabsList>
                <TabsTrigger value="all">
                  All{" "}
                  <span className="text-muted-foreground">
                    {String(provider.memberLinkStatusCounts.total)}
                  </span>
                </TabsTrigger>
                <TabsTrigger value="linked">
                  Linked{" "}
                  <span className="text-muted-foreground">
                    {String(provider.memberLinkStatusCounts.linked)}
                  </span>
                </TabsTrigger>
                <TabsTrigger value="not-linked">
                  Not linked{" "}
                  <span className="text-muted-foreground">
                    {String(
                      provider.memberLinkStatusCounts.total -
                        provider.memberLinkStatusCounts.linked,
                    )}
                  </span>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          ) : null}
        </SheetHeader>

        {provider === null ? null : provider.memberLinksErrorMessage !== null ? (
          <div className="p-4">
            <Notice variant="alert">{provider.memberLinksErrorMessage}</Notice>
          </div>
        ) : !provider.canOpenMemberLinkStatus ? (
          <div className="p-4">
            <Notice>No members to show.</Notice>
          </div>
        ) : !hasLoadedMemberLinkStatus(provider) ? null : provider.memberLinks.length === 0 ? (
          <div className="p-4">
            <Notice>No members to show.</Notice>
          </div>
        ) : (
          <ScrollArea className="min-h-0 flex-1">
            {visibleMemberLinks.length === 0 ? (
              <div className="px-4 py-4">
                <Notice>No users match this filter.</Notice>
              </div>
            ) : (
              <div className="flex flex-col gap-1 py-2">
                {visibleMemberLinks.map((memberLink) => (
                  <div
                    className="flex min-h-14 items-center justify-between gap-4 px-4 py-2.5 hover:bg-muted/60"
                    key={memberLink.userId}
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{memberLink.name}</div>
                      <div className="truncate text-sm text-muted-foreground">
                        {memberLink.email}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 text-xs font-medium",
                        memberLink.linked ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {memberLink.statusLabel}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        )}
      </SheetContent>
    </Sheet>
  );
}

function hasLoadedMemberLinkStatus(
  provider: OrganizationIdentityLinkingProviderRow,
): provider is LoadedMemberLinkStatusProvider {
  return provider.memberLinkStatusCounts !== null;
}

function isLinkStatusFilter(value: string): value is LinkStatusFilter {
  return value === "all" || value === "linked" || value === "not-linked";
}

function filterMemberLinks(
  memberLinks: OrganizationIdentityLinkingProviderRow["memberLinks"],
  filter: LinkStatusFilter,
): OrganizationIdentityLinkingProviderRow["memberLinks"] {
  if (filter === "linked") {
    return memberLinks.filter((memberLink) => memberLink.linked);
  }

  if (filter === "not-linked") {
    return memberLinks.filter((memberLink) => !memberLink.linked);
  }

  return memberLinks;
}
