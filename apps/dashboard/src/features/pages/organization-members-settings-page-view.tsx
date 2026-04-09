import { Notice } from "@mistle/ui";

import { MemberInviteDialog } from "../settings/members/member-invite-dialog.js";
import { MemberRoleChangeDialog } from "../settings/members/member-role-change-dialog.js";
import type {
  MemberAvatar,
  MembersDirectoryFilter,
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
import { TableListingFooter } from "../shared/table-listing-footer.js";
import { TablePagination } from "../shared/table-pagination.js";

export type OrganizationMembersSettingsPageViewProps = {
  activeFilter: MembersDirectoryFilter;
  capabilities: MembershipCapabilities | null;
  capabilitiesErrorMessage: string | null;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
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
  memberAvatarsByUserId: ReadonlyMap<string, MemberAvatar>;
  members: SettingsMember[];
  onChangeRole: (member: SettingsMember) => void;
  onInviteCompleted: () => Promise<void>;
  onInviteDialogOpenChange: (nextOpen: boolean) => void;
  onFilterChange: (nextValue: MembersDirectoryFilter) => void;
  onNextPage: () => void;
  onPreviousPage: () => void;
  onSearchValueChange: (nextValue: string) => void;
  onRemoveMember: (member: SettingsMember) => void;
  onResendInvite: (invitation: SettingsInvitation) => void;
  onRevokeInvite: (invitation: SettingsInvitation) => void;
  onRoleDialogCancel: () => void;
  onRoleDialogOpenChange: (nextOpen: boolean) => void;
  onRoleSelectValueChange: (nextRoleValue: string | null) => void;
  onSaveRole: () => void;
  organizationId: string;
  offset: number;
  pendingMemberOperation: MembersDirectoryPendingMemberOperation;
  resolveInviterDisplayName: (inviterId: string) => string;
  roleChangeDialog: RoleChangeDialogState | null;
  roleUpdateErrorMessage: string | null;
  searchValue: string;
  total: number;
};

export function OrganizationMembersSettingsPageView(
  props: OrganizationMembersSettingsPageViewProps,
): React.JSX.Element {
  if (props.isLoading) {
    return <MembersLoadingState />;
  }

  if (props.loadErrorMessage) {
    return <MembersLoadErrorState message={props.loadErrorMessage} />;
  }

  return (
    <div className="flex flex-col gap-4">
      {props.capabilitiesErrorMessage ? (
        <div className="flex flex-col gap-3">
          <Notice title="Could not load membership permissions" variant="alert">
            Invite and role management actions are unavailable until this loads. Please try again
            later.
          </Notice>
        </div>
      ) : null}

      <MembersDirectoryTable
        activeFilter={props.activeFilter}
        capabilities={props.capabilities}
        canManageInvitations={canManageInvitations(props.capabilities)}
        invitationActionState={props.invitationActionState}
        invitations={props.invitations}
        memberAvatarsByUserId={props.memberAvatarsByUserId}
        members={props.members}
        onChangeRole={props.onChangeRole}
        onFilterChange={props.onFilterChange}
        onRemoveMember={props.onRemoveMember}
        onResendInvite={props.onResendInvite}
        onRevokeInvite={props.onRevokeInvite}
        onSearchValueChange={props.onSearchValueChange}
        pendingMemberOperation={props.pendingMemberOperation}
        resolveInviterDisplayName={props.resolveInviterDisplayName}
        searchValue={props.searchValue}
      />
      <TableListingFooter
        pagination={
          <TablePagination
            hasNextPage={props.hasNextPage}
            hasPreviousPage={props.hasPreviousPage}
            nextPageDisabled={props.isLoading}
            onNextPage={props.onNextPage}
            onPreviousPage={props.onPreviousPage}
            previousPageDisabled={props.isLoading}
          />
        }
        resultsCount={
          <p className="text-muted-foreground text-sm">
            {props.total === 0
              ? "Showing 0 results"
              : `Showing ${props.offset + 1}-${Math.min(
                  props.offset + props.members.length + props.invitations.length,
                  props.total,
                )} of ${props.total}`}
          </p>
        }
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
