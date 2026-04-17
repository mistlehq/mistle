import { ScreenActionButton } from "@mistle/ui";

import { resolveIntegrationLogoPath } from "../integrations/logo.js";

type GoogleSignInButtonProps = {
  disabled?: boolean;
  isPending: boolean;
  onClick: () => Promise<void>;
};

export function GoogleSignInButton(props: GoogleSignInButtonProps): React.JSX.Element {
  return (
    <ScreenActionButton
      className="gap-2.5"
      disabled={props.disabled ?? props.isPending}
      onClick={() => {
        void props.onClick();
      }}
      type="button"
      variant="outline"
    >
      <img
        alt=""
        aria-hidden="true"
        className="size-4 shrink-0"
        src={resolveIntegrationLogoPath({ logoKey: "google" })}
      />
      {props.isPending ? "Redirecting to Google..." : "Continue with Google"}
    </ScreenActionButton>
  );
}
