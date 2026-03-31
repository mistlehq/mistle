import { Button, Spinner } from "@mistle/ui";

import { StatusBox } from "../shared/status-box.js";
import { AuthPageShell, AuthPageWidths } from "./auth-page-shell.js";

type AuthLoginCallbackPageViewProps = {
  callbackError: string | null;
  isCompleting: boolean;
  onBackToLogin: () => void;
};

export function AuthLoginCallbackPageView(
  props: AuthLoginCallbackPageViewProps,
): React.JSX.Element {
  const title =
    props.callbackError === null && props.isCompleting ? "Signing you in" : "Sign-in failed";

  return (
    <AuthPageShell maxWidthClass={AuthPageWidths.SM} title={title}>
      <div className="gap-4 pt-1 flex flex-col">
        {props.callbackError === null && props.isCompleting ? (
          <div
            aria-live="polite"
            className="text-muted-foreground gap-2 flex items-center justify-center text-sm"
            role="status"
          >
            <Spinner />
            <span className="sr-only">Signing you in.</span>
          </div>
        ) : (
          <>
            {props.callbackError === null ? null : (
              <StatusBox tone="destructive">{props.callbackError}</StatusBox>
            )}
            <Button onClick={props.onBackToLogin} type="button" variant="outline">
              Back to login
            </Button>
          </>
        )}
      </div>
    </AuthPageShell>
  );
}
