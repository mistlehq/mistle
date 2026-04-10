import { Spinner } from "@mistle/ui";

import { AuthStatusPage } from "./auth-status-page.js";

export function AuthSwitchOrganizationPageView(): React.JSX.Element {
  return (
    <AuthStatusPage align="center" title="Switching organization">
      <div
        aria-live="polite"
        className="text-muted-foreground gap-2 flex items-center justify-center text-sm"
        role="status"
      >
        <Spinner />
        <span className="sr-only">Switching organization.</span>
      </div>
    </AuthStatusPage>
  );
}
