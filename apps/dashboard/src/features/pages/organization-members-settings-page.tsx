import { Alert, AlertDescription, AlertTitle, Button } from "@mistle/ui";

import { MemberInviteDialog } from "../settings/members/member-invite-dialog.js";
import { MemberRoleChangeDialog } from "../settings/members/member-role-change-dialog.js";
import { inviteMember } from "../settings/members/members-api.js";
import { canManageInvitations } from "../settings/members/members-capability-policy.js";
import { MembersDirectoryTable } from "../settings/members/members-directory-table.js";
import {
  MembersLoadErrorState,
  MembersLoadingState,
} from "../settings/members/members-query-states.js";
import {
  toMembersLoadErrorMessage,
  useOrganizationMembersSettingsState,
} from "../settings/members/use-organization-members-settings-state.js";
import { useSettingsHeaderActions } from "../settings/settings-header-actions.js";
import { useRequiredOrganizationId } from "../shell/require-auth.js";

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

  if (isPageLoading) {
    return <MembersLoadingState />;
  }

  if (membersState.membersQuery.isError || membersState.invitationsQuery.isError) {
    return (
      <MembersLoadErrorState
        message={toMembersLoadErrorMessage({
          membersError: membersState.membersQuery.error,
          invitationsError: membersState.invitationsQuery.error,
          hasMembersError: membersState.membersQuery.isError,
        })}
        onRetry={membersState.retryMembersAndInvitations}
      />
    );
  }

  const capabilities = membersState.capabilities;

  return (
    <div className="flex flex-col gap-4">
      {membersState.capabilitiesQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Membership permissions could not be loaded. Try again.</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-2">
            <span>Invite and role management actions are disabled until permissions load.</span>
            <Button onClick={membersState.onRetryCapabilities} type="button" variant="outline">
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <MembersDirectoryTable
        capabilities={capabilities}
        canManageInvitations={membersState.canManageInvitations}
        invitationActionState={membersState.invitationActionState}
        invitations={membersState.invitations}
        members={membersState.members}
        onChangeRole={membersState.onChangeRole}
        onRemoveMember={membersState.onRemoveMember}
        onResendInvite={membersState.onResendInvite}
        onRevokeInvite={membersState.onRevokeInvite}
        pendingMemberOperation={membersState.pendingMemberOperation}
        resolveInviterDisplayName={membersState.resolveInviterDisplayName}
      />

      <MemberInviteDialog
        assignableRoles={capabilities?.invite.assignableRoles ?? []}
        canExecute={canManageInvitations(capabilities)}
        inviteMemberRequest={inviteMember}
        onCompleted={membersState.onInviteCompleted}
        onOpenChange={membersState.setInviteDialogOpen}
        open={membersState.inviteDialogOpen}
        organizationId={organizationId}
      />

      <MemberRoleChangeDialog
        isUpdatingRole={membersState.isUpdatingRole}
        onCancel={() => membersState.onRoleDialogOpenChange(false)}
        onOpenChange={membersState.onRoleDialogOpenChange}
        onRoleSelectValueChange={membersState.onRoleSelectValueChange}
        onSaveRole={membersState.onSaveRole}
        open={membersState.roleChangeDialog !== null}
        roleChangeDialog={membersState.roleChangeDialog}
        roleUpdateErrorMessage={membersState.roleUpdateErrorMessage}
      />
    </div>
  );
}
