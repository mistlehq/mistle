import { Card, CardContent } from "@mistle/ui";

type InvitationAuthPromptProps = {
  email: string;
  invitedBy: string | null;
  organizationName: string | null;
};

export function InvitationAuthPrompt(props: InvitationAuthPromptProps): React.JSX.Element {
  return (
    <>
      <Card className="w-full">
        <CardContent className="grid gap-4">
          {props.organizationName === null || props.organizationName.length === 0 ? null : (
            <p className="text-sm">
              <span className="text-muted-foreground">Organization:</span>{" "}
              <span className="font-medium">{props.organizationName}</span>
            </p>
          )}
          {props.invitedBy === null || props.invitedBy.length === 0 ? null : (
            <p className="text-sm">
              <span className="text-muted-foreground">Invited by:</span>{" "}
              <span className="font-medium">{props.invitedBy}</span>
            </p>
          )}
        </CardContent>
      </Card>
      <p className="mt-2 text-center text-sm">
        <span className="text-muted-foreground">Sign in as </span>
        <span className="font-medium">{props.email}</span>
        <span className="text-muted-foreground"> to accept this invitation.</span>
      </p>
    </>
  );
}
