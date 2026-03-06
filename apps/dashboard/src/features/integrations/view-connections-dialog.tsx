import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@mistle/ui";

import { formatDate } from "../shared/date-formatters.js";
import type { IntegrationConnection } from "./integrations-service.js";

export type ViewDialogState = {
  displayName: string;
  targetKey: string;
};

type ViewConnectionsDialogProps = {
  connections: readonly IntegrationConnection[];
  dialog: ViewDialogState | null;
  onClose: () => void;
  onOpenUpdateApiKeyDialog: (connectionId: string) => void;
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
              const isApiKeyConnection =
                resolveConnectionAuthScheme(connection.config ?? null) === "api-key";
              return (
                <div className="border rounded-md p-3" key={connection.id}>
                  <div className="items-center justify-between gap-2 flex">
                    <p className="text-sm font-medium">{connection.id}</p>
                  </div>
                  {isApiKeyConnection ? (
                    <div className="mt-2 flex justify-end">
                      <Button
                        onClick={() => {
                          props.onOpenUpdateApiKeyDialog(connection.id);
                        }}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        Update API key
                      </Button>
                    </div>
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

function resolveConnectionAuthScheme(
  config: Record<string, unknown> | null,
): "api-key" | "oauth" | null {
  if (config === null) {
    return null;
  }

  const authScheme = config["auth_scheme"];
  if (authScheme === "api-key") {
    return "api-key";
  }
  if (authScheme === "oauth") {
    return "oauth";
  }
  return null;
}
