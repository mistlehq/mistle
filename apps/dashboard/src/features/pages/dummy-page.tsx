import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@mistle/ui";
import { useState } from "react";
import { useNavigate } from "react-router";

import { authClient } from "../../lib/auth/client.js";
import { ErrorNotice } from "../auth/error-notice.js";
import { resolveErrorMessage } from "../auth/messages.js";
import { useRequiredSession } from "../shell/require-auth.js";

export function DummyPage(): React.JSX.Element {
  const navigate = useNavigate();
  const session = useRequiredSession();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  async function handleSignOut(): Promise<void> {
    setSignOutError(null);
    setIsSigningOut(true);
    const response = await authClient.signOut();
    setIsSigningOut(false);

    if (response.error) {
      setSignOutError(resolveErrorMessage(response.error, "Unable to sign out."));
      return;
    }

    navigate("/auth/login", { replace: true });
  }

  return (
    <main className="from-background to-muted/20 min-h-svh bg-linear-to-b">
      <div className="mx-auto flex min-h-svh w-full max-w-2xl items-center px-4 py-8">
        <Card className="w-full">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Dashboard Placeholder
              <Badge variant="secondary">Scaffold</Badge>
            </CardTitle>
            <CardDescription>Signed in as {session.user.email}</CardDescription>
          </CardHeader>
          <CardContent className="gap-4 flex flex-col">
            <p className="text-muted-foreground text-sm">
              OTP authentication is wired. This page is the temporary post-login destination.
            </p>
            <ErrorNotice message={signOutError} />
            <Button
              className="w-fit"
              disabled={isSigningOut}
              onClick={() => void handleSignOut()}
              type="button"
              variant="outline"
            >
              {isSigningOut ? "Signing out..." : "Sign out"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
