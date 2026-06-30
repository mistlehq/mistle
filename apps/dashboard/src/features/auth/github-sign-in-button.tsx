import { ScreenActionButton } from "@mistle/ui";

import { resolveIntegrationLogoPath } from "../integrations/logo.js";

type GitHubSignInButtonProps = {
  disabled?: boolean;
  isPending: boolean;
  onClick: () => Promise<void>;
};

export function GitHubSignInButton(props: GitHubSignInButtonProps): React.JSX.Element {
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
        src={resolveIntegrationLogoPath({ logoKey: "github" })}
      />
      {props.isPending ? "Redirecting to GitHub..." : "Continue with GitHub"}
    </ScreenActionButton>
  );
}
