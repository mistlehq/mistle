import { useAppPageMeta } from "../navigation/route-meta.js";
import { useOrganizationMembersSettingsState } from "../settings/members/use-organization-members-settings-state.js";
import { PageFrame, resolvePageFrameText } from "../shared/page-frame.js";
import { useRequiredOrganizationId } from "../shell/require-auth.js";
import { OrganizationMembersSettingsPageView } from "./organization-members-settings-page-view.js";

export function OrganizationMembersSettingsPage(): React.JSX.Element {
  const pageMeta = useAppPageMeta();
  const activeOrganizationId = useRequiredOrganizationId();
  const membersState = useOrganizationMembersSettingsState({
    activeOrganizationId,
  });
  const { title, description } = resolvePageFrameText(pageMeta, "Members");

  return (
    <PageFrame description={description} title={title}>
      <OrganizationMembersSettingsPageView viewModel={membersState.viewModel} />
    </PageFrame>
  );
}
