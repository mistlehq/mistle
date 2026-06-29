import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  CopyableValue,
  DropdownMenuItem,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  MoreActionsMenu,
  Notice,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@mistle/ui";
import { KeyIcon, ProhibitIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { ApiKeyMistleResourceAccessSummary } from "../settings/api-keys/api-key-permissions-summary.js";
import type { ApiKey } from "../settings/api-keys/api-keys-service.js";
import { formatDateTime } from "../shared/date-formatters.js";

export type OrganizationApiKeysSettingsPageViewProps = {
  apiKeys: readonly ApiKey[];
  createdApiKeyNotice: {
    name: string;
    token: string;
  } | null;
  isLoading: boolean;
  listErrorMessage: string | null;
  onDismissCreatedApiKeyNotice: () => void;
  onRevokeApiKey: (apiKey: ApiKey) => void;
  revokeErrorMessage: string | null;
  revokingApiKeyId: string | null;
};

export function OrganizationApiKeysSettingsPageView(
  props: OrganizationApiKeysSettingsPageViewProps,
): React.JSX.Element {
  const [apiKeyPendingRevoke, setApiKeyPendingRevoke] = useState<ApiKey | null>(null);

  return (
    <div className="flex flex-col gap-4">
      {props.revokeErrorMessage === null ? null : (
        <Notice variant="alert">{props.revokeErrorMessage}</Notice>
      )}
      {props.createdApiKeyNotice === null ? null : (
        <Notice variant="success">
          <div className="flex flex-col gap-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 flex-col gap-1">
                <div className="text-base font-medium">API key created</div>
                <p>
                  Copy the token for {props.createdApiKeyNotice.name} now. It will not be shown
                  again.
                </p>
              </div>
              <Button
                onClick={props.onDismissCreatedApiKeyNotice}
                size="sm"
                type="button"
                variant="outline"
              >
                Done
              </Button>
            </div>
            <CopyableValue
              copyAriaLabel="Copy API key token"
              label="Token"
              value={props.createdApiKeyNotice.token}
            />
          </div>
        </Notice>
      )}
      {props.listErrorMessage === null ? null : (
        <Notice variant="alert">{props.listErrorMessage}</Notice>
      )}
      {props.isLoading ? null : props.apiKeys.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <KeyIcon aria-hidden className="size-8 text-muted-foreground" />
            <EmptyTitle>No API keys</EmptyTitle>
            <EmptyDescription>
              Create an API key to access Mistle from scripts or services.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table className="min-w-[64rem] table-fixed">
          <TableHeader className="bg-muted/60">
            <TableRow className="h-9 border-b">
              <TableHead className="text-foreground w-[17%] py-2 text-[11px] font-semibold tracking-[0.08em] uppercase">
                Name
              </TableHead>
              <TableHead className="text-foreground w-[26%] py-2 text-[11px] font-semibold tracking-[0.08em] uppercase">
                Key prefix
              </TableHead>
              <TableHead className="text-foreground w-[14%] py-2 text-[11px] font-semibold tracking-[0.08em] uppercase">
                Permissions
              </TableHead>
              <TableHead className="text-foreground w-[18%] py-2 text-[11px] font-semibold tracking-[0.08em] uppercase whitespace-nowrap">
                Last used
              </TableHead>
              <TableHead className="text-foreground w-[20%] py-2 text-[11px] font-semibold tracking-[0.08em] uppercase whitespace-nowrap">
                Created
              </TableHead>
              <TableHead className="w-[5%] py-2">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {props.apiKeys.map((apiKey) => {
              const keyPrefixLabel = formatApiKeyPrefixLabel(apiKey.secretPrefix);

              return (
                <TableRow key={apiKey.id}>
                  <TableCell className="max-w-0 align-middle font-medium whitespace-normal break-words">
                    {apiKey.name}
                  </TableCell>
                  <TableCell className="max-w-0 align-middle">
                    <code
                      className="text-muted-foreground block max-w-full truncate text-xs"
                      title={keyPrefixLabel}
                    >
                      {keyPrefixLabel}
                    </code>
                  </TableCell>
                  <TableCell className="align-middle whitespace-nowrap">
                    <ApiKeyMistleResourceAccessSummary
                      apiKey={apiKey}
                      className="px-0 hover:bg-transparent"
                      description={
                        <>
                          {apiKey.name} can access these Mistle resources. Access is limited by this
                          API key&apos;s permissions.
                        </>
                      }
                    />
                  </TableCell>
                  <DateTimeTableCell emptyLabel="Never" value={apiKey.lastUsedAt} />
                  <DateTimeTableCell value={apiKey.createdAt} />
                  <TableCell className="align-middle text-right">
                    <div className="flex justify-end">
                      <MoreActionsMenu
                        disabled={props.revokingApiKeyId !== null}
                        triggerLabel={`API key actions for ${apiKey.name}`}
                        triggerSize="icon-xs"
                      >
                        <DropdownMenuItem
                          onClick={() => {
                            setApiKeyPendingRevoke(apiKey);
                          }}
                          variant="destructive"
                        >
                          <ProhibitIcon aria-hidden className="size-4" />
                          Revoke key
                        </DropdownMenuItem>
                      </MoreActionsMenu>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) {
            setApiKeyPendingRevoke(null);
          }
        }}
        open={apiKeyPendingRevoke !== null}
      >
        {apiKeyPendingRevoke === null ? null : (
          <AlertDialogContent size="sm">
            <AlertDialogHeader>
              <AlertDialogTitle>Revoke API key?</AlertDialogTitle>
              <AlertDialogDescription>
                Requests using {apiKeyPendingRevoke.name} will stop working immediately.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep key</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  props.onRevokeApiKey(apiKeyPendingRevoke);
                  setApiKeyPendingRevoke(null);
                }}
                variant="destructive"
              >
                Revoke key
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </div>
  );
}

function formatApiKeyPrefixLabel(secretPrefix: string): string {
  return `mstl_apk_${secretPrefix}`;
}

function DateTimeTableCell(props: {
  emptyLabel?: string;
  value: string | null;
}): React.JSX.Element {
  const label = formatNullableDate(props.value, props.emptyLabel ?? "Unknown");

  return (
    <TableCell className="max-w-0 align-middle whitespace-nowrap">
      {props.value === null ? (
        <span className="block truncate" title={label}>
          {label}
        </span>
      ) : (
        <time className="block truncate" dateTime={props.value} title={label}>
          {label}
        </time>
      )}
    </TableCell>
  );
}

function formatNullableDate(value: string | null, emptyLabel: string): string {
  if (value === null) {
    return emptyLabel;
  }

  return formatDateTime(value);
}
