import { Button } from "@mistle/ui";

import { useSettingsHeaderActions } from "../settings/settings-header-actions.js";
import { PagePlaceholder } from "./page-placeholder.js";

export function OrganizationMembersSettingsPage(): React.JSX.Element {
  useSettingsHeaderActions(
    <Button disabled type="button">
      Invite members
    </Button>,
  );

  return (
    <PagePlaceholder
      description="Members domain migration lands in Slice 5. Invite and role controls will be wired there."
      title="Members"
    />
  );
}
