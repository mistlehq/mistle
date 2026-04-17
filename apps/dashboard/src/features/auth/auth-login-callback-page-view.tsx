import { ScreenActionButton, Spinner, Notice } from "@mistle/ui";

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
              <Notice variant="alert">{props.callbackError}</Notice>
            )}
            <ScreenActionButton onClick={props.onBackToLogin} type="button" variant="outline">
              Back to login
            </ScreenActionButton>
          </>
        )}
      </div>
    </AuthPageShell>
  );
}
