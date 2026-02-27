import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@mistle/ui";

import type { SettingsInvitation } from "./members-api.js";
import { resolveInvitationDisplayStatus } from "./members-directory-model.js";
import { formatDate, invitationStatusLabel } from "./members-formatters.js";

export function InvitationDetailsDialog(input: {
  invitation: SettingsInvitation | null;
  open: boolean;
  resolveInviterDisplayName: (inviterId: string) => string;
  onOpenChange: (nextOpen: boolean) => void;
}): React.JSX.Element {
  return (
    <Dialog onOpenChange={input.onOpenChange} open={input.open}>
      {input.invitation ? (
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invitation details</DialogTitle>
          </DialogHeader>
          <dl className="gap-3 grid text-sm">
            <div className="gap-1 grid">
              <dt className="text-muted-foreground">Email</dt>
              <dd>{input.invitation.email}</dd>
            </div>
            <div className="gap-1 grid">
              <dt className="text-muted-foreground">Status</dt>
              <dd>
                {invitationStatusLabel(
                  input.invitation.role,
                  resolveInvitationDisplayStatus(input.invitation),
                )}
              </dd>
            </div>
            <div className="gap-1 grid">
              <dt className="text-muted-foreground">Invited by</dt>
              <dd>{input.resolveInviterDisplayName(input.invitation.inviterId)}</dd>
            </div>
            <div className="gap-1 grid">
              <dt className="text-muted-foreground">Invited at</dt>
              <dd>{formatDate(input.invitation.createdAt)}</dd>
            </div>
            <div className="gap-1 grid">
              <dt className="text-muted-foreground">Expires at</dt>
              <dd>{formatDate(input.invitation.expiresAt)}</dd>
            </div>
          </dl>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
