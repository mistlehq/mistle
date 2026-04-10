import { Button, Notice, Tabs, TabsList, TabsTrigger } from "@mistle/ui";

import { MemberInviteDialog } from "../settings/members/member-invite-dialog.js";
import { MemberRoleChangeDialog } from "../settings/members/member-role-change-dialog.js";
import { canManageInvitations } from "../settings/members/members-capability-policy.js";
import { MembersDirectoryTable } from "../settings/members/members-directory-table.js";
import { clampMembersDirectoryOffset } from "../settings/members/members-pagination.js";
import {
  MembersLoadErrorState,
  MembersLoadingState,
} from "../settings/members/members-query-states.js";
import type { OrganizationMembersSettingsPageViewModel } from "../settings/members/organization-members-settings-view-model.js";
import { TableListingFooter } from "../shared/table-listing-footer.js";
import { TablePagination } from "../shared/table-pagination.js";

export function OrganizationMembersSettingsPageView(input: {
  viewModel: OrganizationMembersSettingsPageViewModel;
}): React.JSX.Element {
  const props = input.viewModel;
  const visibleRowCount = props.members.length + props.invitations.length;
  const visibleOffset = clampMembersDirectoryOffset({
    limit: props.limit,
    offset: props.offset,
    total: props.total,
  });

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
      {props.listErrorNoticeMessage ? (
        <Notice title="Could not refresh directory" variant="alert">
          {props.listErrorNoticeMessage} Please try again later.
        </Notice>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <Tabs
          onValueChange={(nextValue) => {
            if (nextValue === "members" || nextValue === "invitations") {
              props.onFilterChange(nextValue);
            }
          }}
          value={props.activeFilter}
        >
          <TabsList variant="line">
            <TabsTrigger value="members">Active</TabsTrigger>
            <TabsTrigger value="invitations">Invited</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button
          disabled={props.inviteMembersDisabled}
          onClick={() => {
            props.onInviteDialogOpenChange(true);
          }}
          type="button"
        >
          Invite members
        </Button>
      </div>

      <MembersDirectoryTable
        activeFilter={props.activeFilter}
        capabilities={props.capabilities}
        canManageInvitations={canManageInvitations(props.capabilities)}
        invitationActionState={props.invitationActionState}
        invitations={props.invitations}
        memberAvatarsByUserId={props.memberAvatarsByUserId}
        members={props.members}
        onChangeRole={props.onChangeRole}
        onRemoveMember={props.onRemoveMember}
        onResendInvite={props.onResendInvite}
        onRevokeInvite={props.onRevokeInvite}
        onSearchValueChange={props.onSearchValueChange}
        pendingMemberOperation={props.pendingMemberOperation}
        searchValue={props.searchValue}
      />
      <TableListingFooter
        pagination={
          <TablePagination
            hasNextPage={props.hasNextPage}
            hasPreviousPage={props.hasPreviousPage}
            nextPageDisabled={props.isListFetching}
            onNextPage={props.onNextPage}
            onPreviousPage={props.onPreviousPage}
            previousPageDisabled={props.isListFetching}
          />
        }
        resultsCount={
          <p className="text-muted-foreground text-sm">
            {props.total === 0
              ? "Showing 0 results"
              : `Showing ${visibleOffset + 1}-${Math.min(
                  visibleOffset + visibleRowCount,
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
