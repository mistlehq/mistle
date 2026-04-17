import { Card, CardContent, Notice, ScreenActionButton } from "@mistle/ui";

import { AuthStatusPage } from "../auth/auth-status-page.js";
import { formatInvitationRole } from "./invitation-accept-state.js";

type InvitationAccessViewProps = {
  invitedEmail: string;
  invitedBy: string;
  mutationError: string | null;
  onAccept: () => void;
  onDecline: () => void;
  organizationName: string;
  role: string;
  isAccepting: boolean;
  isDeclining: boolean;
};

export function InvitationAccessView(props: InvitationAccessViewProps): React.JSX.Element {
  const isSubmitting = props.isAccepting || props.isDeclining;

  return (
    <AuthStatusPage title="You've been invited to join Mistle">
      <Card className="w-full">
        <CardContent className="grid gap-4">
          <dl className="grid gap-3">
            <div>
              <dt className="text-muted-foreground text-xs">Organization</dt>
              <dd className="text-sm font-medium">{props.organizationName}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Role</dt>
              <dd className="text-sm">{formatInvitationRole(props.role)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Invited email</dt>
              <dd className="text-sm">{props.invitedEmail}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Invited by</dt>
              <dd className="text-sm">{props.invitedBy}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
      {props.mutationError === null ? null : (
        <Notice title="Something went wrong" variant="alert">
          {props.mutationError}
        </Notice>
      )}
      <div className="flex flex-col gap-4">
        <ScreenActionButton disabled={isSubmitting} onClick={props.onAccept} type="button">
          {props.isAccepting ? "Accepting..." : "Accept invitation"}
        </ScreenActionButton>
        <ScreenActionButton
          className="text-zinc-500 hover:text-zinc-700"
          disabled={isSubmitting}
          onClick={props.onDecline}
          type="button"
          variant="link"
        >
          {props.isDeclining ? "Declining..." : "Decline"}
        </ScreenActionButton>
      </div>
    </AuthStatusPage>
  );
}
