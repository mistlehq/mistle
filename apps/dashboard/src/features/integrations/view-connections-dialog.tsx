import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@mistle/ui";
import { PencilSimpleIcon } from "@phosphor-icons/react";

import { formatDate } from "../shared/date-formatters.js";
import { formatConnectionAuthMethodLabel, resolveConnectionAuthScheme } from "./connection-auth.js";
import type { IntegrationConnection } from "./integrations-service.js";

export type ViewDialogState = {
  displayName: string;
  targetKey: string;
};

type ViewConnectionsDialogProps = {
  connections: readonly IntegrationConnection[];
  dialog: ViewDialogState | null;
  onClose: () => void;
  onOpenEditConnectionDialog: (input: {
    connectionId: string;
    connectionDisplayName: string;
    connectionMethodId: "api-key" | "oauth" | null;
  }) => void;
};

export function ViewConnectionsDialog(props: ViewConnectionsDialogProps) {
  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          props.onClose();
        }
      }}
      open={props.dialog !== null}
    >
      {props.dialog ? (
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{props.dialog.displayName} connections</DialogTitle>
            <DialogDescription>Review existing connections for this integration.</DialogDescription>
          </DialogHeader>
          <div className="gap-2 flex flex-col">
            {props.connections.map((connection) => {
              const connectionAuthScheme = resolveConnectionAuthScheme(connection.config ?? null);
              const connectionAuthMethodLabel =
                connectionAuthScheme === null
                  ? null
                  : formatConnectionAuthMethodLabel(connectionAuthScheme);
              return (
                <div className="relative border rounded-md p-3" key={connection.id}>
                  <Button
                    aria-label="Edit connection"
                    className="absolute top-3 right-3"
                    onClick={() => {
                      props.onOpenEditConnectionDialog({
                        connectionId: connection.id,
                        connectionDisplayName: connection.displayName,
                        connectionMethodId: connectionAuthScheme,
                      });
                    }}
                    size="icon-sm"
                    type="button"
                    variant="outline"
                  >
                    <PencilSimpleIcon aria-hidden className="size-4" />
                  </Button>
                  <div className="pr-10">
                    <p className="text-sm font-medium">{connection.displayName}</p>
                  </div>
                  {connectionAuthMethodLabel ? (
                    <p className="text-muted-foreground mt-1 text-xs">
                      Auth method: {connectionAuthMethodLabel}
                    </p>
                  ) : null}
                  <p className="text-muted-foreground mt-1 text-xs">
                    Created: {formatDate(connection.createdAt)}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Updated: {formatDate(connection.updatedAt)}
                  </p>
                </div>
              );
            })}
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
