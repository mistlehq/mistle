import { Alert, AlertDescription, AlertTitle, Button } from "@mistle/ui";

import { MemberInviteDialog } from "../settings/members/member-invite-dialog.js";
import { MemberRoleChangeDialog } from "../settings/members/member-role-change-dialog.js";
import type {
  MembershipCapabilities,
  SettingsInvitation,
  SettingsMember,
} from "../settings/members/members-api.js";
import { canManageInvitations } from "../settings/members/members-capability-policy.js";
import type { RoleChangeDialogState } from "../settings/members/members-capability-policy.js";
import type {
  MembersDirectoryInvitationActionState,
  MembersDirectoryPendingMemberOperation,
} from "../settings/members/members-directory-model.js";
import { MembersDirectoryTable } from "../settings/members/members-directory-table.js";
import {
  MembersLoadErrorState,
  MembersLoadingState,
} from "../settings/members/members-query-states.js";

export type OrganizationMembersSettingsPageViewProps = {
  capabilities: MembershipCapabilities | null;
  capabilitiesErrorMessage: string | null;
  invitationActionState: MembersDirectoryInvitationActionState;
  invitations: SettingsInvitation[];
  inviteDialogOpen: boolean;
  inviteMemberRequest: (request: {
    organizationId: string;
    email: string;
    role: MembershipCapabilities["actorRole"];
  }) => Promise<{
    status: string | null;
    message: string | null;
    code: string | null;
    raw: unknown;
  }>;
  isLoading: boolean;
  isUpdatingRole: boolean;
  loadErrorMessage: string | null;
  members: SettingsMember[];
  onChangeRole: (member: SettingsMember) => void;
  onInviteCompleted: () => Promise<void>;
  onInviteDialogOpenChange: (nextOpen: boolean) => void;
  onRemoveMember: (member: SettingsMember) => void;
  onResendInvite: (invitation: SettingsInvitation) => void;
  onRetryCapabilities: () => void;
  onRetryLoad: () => void;
  onRevokeInvite: (invitation: SettingsInvitation) => void;
  onRoleDialogCancel: () => void;
  onRoleDialogOpenChange: (nextOpen: boolean) => void;
  onRoleSelectValueChange: (nextRoleValue: string | null) => void;
  onSaveRole: () => void;
  organizationId: string;
  pendingMemberOperation: MembersDirectoryPendingMemberOperation;
  resolveInviterDisplayName: (inviterId: string) => string;
  roleChangeDialog: RoleChangeDialogState | null;
  roleUpdateErrorMessage: string | null;
};

export function OrganizationMembersSettingsPageView(
  props: OrganizationMembersSettingsPageViewProps,
): React.JSX.Element {
  if (props.isLoading) {
    return <MembersLoadingState />;
  }

  if (props.loadErrorMessage) {
    return <MembersLoadErrorState message={props.loadErrorMessage} onRetry={props.onRetryLoad} />;
  }

  return (
    <div className="flex flex-col gap-4">
      {props.capabilitiesErrorMessage ? (
        <Alert variant="destructive">
          <AlertTitle>Membership permissions could not be loaded. Try again.</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-2">
            <span>Invite and role management actions are disabled until permissions load.</span>
            <Button onClick={props.onRetryCapabilities} type="button" variant="outline">
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <MembersDirectoryTable
        capabilities={props.capabilities}
        canManageInvitations={canManageInvitations(props.capabilities)}
        invitationActionState={props.invitationActionState}
        invitations={props.invitations}
        members={props.members}
        onChangeRole={props.onChangeRole}
        onRemoveMember={props.onRemoveMember}
        onResendInvite={props.onResendInvite}
        onRevokeInvite={props.onRevokeInvite}
        pendingMemberOperation={props.pendingMemberOperation}
        resolveInviterDisplayName={props.resolveInviterDisplayName}
      />

      <MemberInviteDialog
        assignableRoles={props.capabilities?.invite.assignableRoles ?? []}
        canExecute={canManageInvitations(props.capabilities)}
        inviteMemberRequest={props.inviteMemberRequest}
        onCompleted={props.onInviteCompleted}
        onOpenChange={props.onInviteDialogOpenChange}
        open={props.inviteDialogOpen}
        organizationId={props.organizationId}
      />

      <MemberRoleChangeDialog
        isUpdatingRole={props.isUpdatingRole}
        onCancel={props.onRoleDialogCancel}
        onOpenChange={props.onRoleDialogOpenChange}
        onRoleSelectValueChange={props.onRoleSelectValueChange}
        onSaveRole={props.onSaveRole}
        open={props.roleChangeDialog !== null}
        roleChangeDialog={props.roleChangeDialog}
        roleUpdateErrorMessage={props.roleUpdateErrorMessage}
      />
    </div>
  );
}
