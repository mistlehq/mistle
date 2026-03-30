import { Spinner } from "@mistle/ui";

import { AuthPageShell, AuthPageWidths } from "../auth/auth-page-shell.js";

export function InvitationLoadingState(): React.JSX.Element {
  return (
    <AuthPageShell maxWidthClass={AuthPageWidths.LG} title={null}>
      <div className="flex w-full justify-center">
        <Spinner aria-label="Loading invitation" className="size-6" />
      </div>
    </AuthPageShell>
  );
}
