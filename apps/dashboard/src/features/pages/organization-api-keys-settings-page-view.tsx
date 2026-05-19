import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  CopyableValue,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Notice,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@mistle/ui";
import { KeyIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Link as RouterLink } from "react-router";

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
      <div className="flex items-center justify-end gap-3">
        <Button
          nativeButton={false}
          render={<RouterLink to="/settings/organization/api-keys/new" />}
        >
          <PlusIcon aria-hidden />
          Create API key
        </Button>
      </div>

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
      {props.isLoading ? (
        <p className="text-muted-foreground text-sm">Loading API keys...</p>
      ) : props.apiKeys.length === 0 ? (
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
        <Table className="min-w-[48rem]">
          <TableHeader className="bg-muted/60">
            <TableRow className="h-9 border-b">
              <TableHead className="text-foreground py-2 text-xs font-semibold tracking-wide uppercase">
                Name
              </TableHead>
              <TableHead className="text-foreground py-2 text-xs font-semibold tracking-wide uppercase">
                Key
              </TableHead>
              <TableHead className="text-foreground py-2 text-xs font-semibold tracking-wide uppercase">
                Permissions
              </TableHead>
              <TableHead className="text-foreground py-2 text-xs font-semibold tracking-wide uppercase whitespace-nowrap">
                Last used
              </TableHead>
              <TableHead className="text-foreground py-2 text-xs font-semibold tracking-wide uppercase whitespace-nowrap">
                Created
              </TableHead>
              <TableHead className="text-right text-foreground py-2 text-xs font-semibold tracking-wide uppercase whitespace-nowrap">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {props.apiKeys.map((apiKey) => (
              <TableRow key={apiKey.id}>
                <TableCell className="font-medium">{apiKey.name}</TableCell>
                <TableCell>
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                    {apiKey.secretPrefix}...
                  </code>
                </TableCell>
                <TableCell>
                  <ApiKeyPermissionsCell permissions={apiKey.permissions} />
                </TableCell>
                <TableCell>{formatNullableDate(apiKey.lastUsedAt, "Never")}</TableCell>
                <TableCell>{formatDateTime(apiKey.createdAt)}</TableCell>
                <TableCell className="text-right">
                  <Button
                    aria-label={`Revoke ${apiKey.name}`}
                    disabled={props.revokingApiKeyId !== null}
                    onClick={() => {
                      setApiKeyPendingRevoke(apiKey);
                    }}
                    size="icon-sm"
                    type="button"
                    variant="destructive"
                  >
                    <TrashIcon aria-hidden />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
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

function ApiKeyPermissionsCell(input: { permissions: readonly string[] }): React.JSX.Element {
  const visiblePermissions = input.permissions.slice(0, 3);
  const hiddenCount = input.permissions.length - visiblePermissions.length;

  return (
    <div className="flex max-w-lg flex-wrap gap-1.5">
      {visiblePermissions.map((permission) => (
        <Badge key={permission} variant="outline">
          {permission}
        </Badge>
      ))}
      {hiddenCount > 0 ? <Badge variant="secondary">+ {String(hiddenCount)} more</Badge> : null}
    </div>
  );
}

function formatNullableDate(value: string | null, emptyLabel: string): string {
  if (value === null) {
    return emptyLabel;
  }

  return formatDateTime(value);
}
