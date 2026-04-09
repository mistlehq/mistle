import { Button } from "@mistle/ui";
import { useMemo } from "react";

import { useAppPageMeta } from "../navigation/route-meta.js";
import { inviteMember } from "../settings/members/members-api.js";
import {
  toMembersLoadErrorMessage,
  useOrganizationMembersSettingsState,
} from "../settings/members/use-organization-members-settings-state.js";
import { PageFrame, resolvePageFrameText } from "../shared/page-frame.js";
import { useRequiredOrganizationId } from "../shell/require-auth.js";
import { OrganizationMembersSettingsPageView } from "./organization-members-settings-page-view.js";

export function OrganizationMembersSettingsPage(): React.JSX.Element {
  const pageMeta = useAppPageMeta();
  const organizationId = useRequiredOrganizationId();
  const membersState = useOrganizationMembersSettingsState({
    organizationId,
  });
  const { title, description } = resolvePageFrameText(pageMeta, "Members");
  const headerActions = useMemo(
    () => (
      <Button
        disabled={membersState.inviteMembersDisabled}
        onClick={() => membersState.setInviteDialogOpen(true)}
        type="button"
      >
        Invite members
      </Button>
    ),
    [membersState.inviteMembersDisabled, membersState.setInviteDialogOpen],
  );

  const isPageLoading =
    (membersState.directoryQuery.data === undefined && membersState.directoryQuery.isPending) ||
    (membersState.capabilitiesQuery.data === undefined && membersState.capabilitiesQuery.isPending);

  return (
    <PageFrame description={description} headerActions={headerActions} title={title}>
      <OrganizationMembersSettingsPageView
        capabilities={membersState.capabilities}
        capabilitiesErrorMessage={
          membersState.capabilitiesQuery.isError
            ? "Membership permissions could not be loaded."
            : null
        }
        invitationActionState={membersState.invitationActionState}
        invitations={membersState.invitations}
        inviteDialogOpen={membersState.inviteDialogOpen}
        inviteMemberRequest={inviteMember}
        isLoading={isPageLoading}
        isUpdatingRole={membersState.isUpdatingRole}
        limit={membersState.limit}
        loadErrorMessage={
          membersState.directoryQuery.isError
            ? toMembersLoadErrorMessage({
                directoryError: membersState.directoryQuery.error,
              })
            : null
        }
        activeFilter={membersState.activeFilter}
        hasNextPage={membersState.hasNextPage}
        hasPreviousPage={membersState.hasPreviousPage}
        members={membersState.members}
        memberAvatarsByUserId={membersState.memberAvatarsByUserId}
        onChangeRole={membersState.onChangeRole}
        onInviteCompleted={membersState.onInviteCompleted}
        onInviteDialogOpenChange={membersState.setInviteDialogOpen}
        onFilterChange={membersState.onFilterChange}
        onNextPage={membersState.onNextPage}
        onPreviousPage={membersState.onPreviousPage}
        onSearchValueChange={membersState.onSearchValueChange}
        onRemoveMember={membersState.onRemoveMember}
        onResendInvite={membersState.onResendInvite}
        onRevokeInvite={membersState.onRevokeInvite}
        onRoleDialogCancel={() => membersState.onRoleDialogOpenChange(false)}
        onRoleDialogOpenChange={membersState.onRoleDialogOpenChange}
        onRoleSelectValueChange={membersState.onRoleSelectValueChange}
        onSaveRole={membersState.onSaveRole}
        organizationId={organizationId}
        pendingMemberOperation={membersState.pendingMemberOperation}
        resolveInviterDisplayName={membersState.resolveInviterDisplayName}
        roleChangeDialog={membersState.roleChangeDialog}
        roleUpdateErrorMessage={membersState.roleUpdateErrorMessage}
        searchValue={membersState.searchValue}
        total={membersState.total}
        offset={membersState.offset}
      />
    </PageFrame>
  );
}
