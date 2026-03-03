import {
  Badge,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@mistle/ui";

import type { IntegrationConnection } from "./integrations-service.js";

export type ViewDialogState = {
  displayName: string;
  targetKey: string;
};

type ViewConnectionsDialogProps = {
  connections: readonly IntegrationConnection[];
  dialog: ViewDialogState | null;
  onClose: () => void;
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
              const statusUi = resolveConnectionStatusVariant(connection.status);
              return (
                <div className="border rounded-md p-3" key={connection.id}>
                  <div className="items-center justify-between gap-2 flex">
                    <p className="text-sm font-medium">{connection.id}</p>
                    <Badge className={statusUi.className} variant={statusUi.variant}>
                      {resolveConnectionStatusLabel(connection.status)}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground mt-1 text-xs">
                    Created: {connection.createdAt}
                  </p>
                  <p className="text-muted-foreground text-xs">Updated: {connection.updatedAt}</p>
                </div>
              );
            })}
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function resolveConnectionStatusLabel(status: IntegrationConnection["status"]): string {
  if (status === "active") {
    return "Connected";
  }
  if (status === "error") {
    return "Error";
  }

  return "Revoked";
}

function resolveConnectionStatusVariant(status: IntegrationConnection["status"]): {
  className?: string;
  variant: "secondary" | "destructive" | "outline";
} {
  if (status === "active") {
    return {
      className: "bg-emerald-600 text-white hover:bg-emerald-600/90",
      variant: "secondary",
    };
  }

  if (status === "error") {
    return {
      variant: "destructive",
    };
  }

  return {
    variant: "outline",
  };
}
