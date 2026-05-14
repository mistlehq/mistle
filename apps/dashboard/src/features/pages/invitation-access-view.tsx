import { Card, CardContent, DefinitionList, Notice, ScreenActionButton } from "@mistle/ui";

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
  const invitationDetails = [
    {
      id: "organization",
      label: "Organization",
      value: props.organizationName,
    },
    {
      id: "role",
      label: "Role",
      value: formatInvitationRole(props.role),
    },
    {
      id: "invited-email",
      label: "Invited email",
      value: props.invitedEmail,
    },
    {
      id: "invited-by",
      label: "Invited by",
      value: props.invitedBy,
    },
  ];

  return (
    <AuthStatusPage title="You've been invited to join Mistle">
      <Card className="w-full">
        <CardContent>
          <DefinitionList items={invitationDetails} />
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
          className="text-muted-foreground hover:text-foreground"
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
