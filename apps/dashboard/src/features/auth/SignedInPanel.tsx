import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Separator,
} from "@mistle/ui";

import type { SessionData } from "./types.js";

import { ErrorNotice } from "./ErrorNotice.js";

type SignedInPanelProps = {
  session: SessionData;
  isSigningOut: boolean;
  sessionError: string | null;
  onSignOut: () => Promise<void>;
};

export function SignedInPanel(props: SignedInPanelProps): React.JSX.Element {
  if (!props.session) {
    throw new Error("SignedInPanel requires a non-null session.");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mistle dashboard</CardTitle>
        <CardDescription>Signed in as {props.session.user.email}</CardDescription>
        <CardAction>
          <Button
            disabled={props.isSigningOut}
            onClick={() => void props.onSignOut()}
            type="button"
          >
            {props.isSigningOut ? "Signing out..." : "Sign out"}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="gap-3 flex flex-col">
        <div className="text-muted-foreground gap-2 flex items-center text-sm">
          <span>Auth scaffolding is connected via Better Auth.</span>
          <Badge variant="outline">Connected</Badge>
        </div>
        <Separator />
        <ErrorNotice message={props.sessionError} />
      </CardContent>
    </Card>
  );
}
