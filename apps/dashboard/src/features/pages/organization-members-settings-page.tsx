import { Button } from "@mistle/ui";

import { inviteMember } from "../settings/members/members-api.js";
import {
  toMembersLoadErrorMessage,
  useOrganizationMembersSettingsState,
} from "../settings/members/use-organization-members-settings-state.js";
import { useSettingsHeaderActions } from "../settings/settings-header-actions.js";
import { useRequiredOrganizationId } from "../shell/require-auth.js";
import { OrganizationMembersSettingsPageView } from "./organization-members-settings-page-view.js";

export function OrganizationMembersSettingsPage(): React.JSX.Element {
  const organizationId = useRequiredOrganizationId();
  const membersState = useOrganizationMembersSettingsState({
    organizationId,
  });
  const headerActions = (
    <Button
      disabled={membersState.inviteMembersDisabled}
      onClick={() => membersState.setInviteDialogOpen(true)}
      type="button"
    >
      Invite members
    </Button>
  );
  useSettingsHeaderActions(headerActions);

  const isPageLoading =
    membersState.membersQuery.isPending ||
    membersState.invitationsQuery.isPending ||
    membersState.capabilitiesQuery.isPending;

  return (
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
      loadErrorMessage={
        membersState.membersQuery.isError || membersState.invitationsQuery.isError
          ? toMembersLoadErrorMessage({
              membersError: membersState.membersQuery.error,
              invitationsError: membersState.invitationsQuery.error,
              hasMembersError: membersState.membersQuery.isError,
            })
          : null
      }
      members={membersState.members}
      onChangeRole={membersState.onChangeRole}
      onInviteCompleted={membersState.onInviteCompleted}
      onInviteDialogOpenChange={membersState.setInviteDialogOpen}
      onRemoveMember={membersState.onRemoveMember}
      onResendInvite={membersState.onResendInvite}
      onRetryCapabilities={membersState.onRetryCapabilities}
      onRetryLoad={membersState.retryMembersAndInvitations}
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
    />
  );
}
