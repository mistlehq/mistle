import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@mistle/ui";

import type {
  MemberAvatar,
  MembersDirectoryFilter,
  MembershipCapabilities,
  SettingsInvitation,
  SettingsMember,
} from "./members-api.js";
import {
  type MembersDirectoryInvitationActionState,
  type MembersDirectoryPendingMemberOperation,
} from "./members-directory-model.js";
import { buildMembersDirectoryRows } from "./members-directory-model.js";
import { MembersDirectoryToolbar } from "./members-directory-toolbar.js";
import { DirectoryTableRow } from "./members-table-rows.js";
import { buildMembersDirectoryTableRowViewModels } from "./members-table-view-model.js";

export function MembersDirectoryTable(input: {
  activeFilter: MembersDirectoryFilter;
  members: SettingsMember[];
  memberAvatarsByUserId: ReadonlyMap<string, MemberAvatar>;
  invitations: SettingsInvitation[];
  capabilities: MembershipCapabilities | null;
  canManageInvitations: boolean;
  pendingMemberOperation: MembersDirectoryPendingMemberOperation;
  invitationActionState: MembersDirectoryInvitationActionState;
  searchValue: string;
  onSearchValueChange: (nextValue: string) => void;
  onChangeRole: (member: SettingsMember) => void;
  onRemoveMember: (member: SettingsMember) => void;
  onRevokeInvite: (invitation: SettingsInvitation) => void;
  onResendInvite: (invitation: SettingsInvitation) => void;
}): React.JSX.Element {
  const showNameColumn = input.activeFilter === "members";
  const showInvitationStatusColumn = input.activeFilter === "invitations";
  const showInvitedByColumn = input.activeFilter === "invitations";
  const showExpiresColumn = input.activeFilter === "invitations";
  const rows = buildMembersDirectoryRows({
    members: input.members,
    invitations: input.invitations,
  });
  const tableRows = buildMembersDirectoryTableRowViewModels({
    rows,
    memberAvatarsByUserId: input.memberAvatarsByUserId,
    capabilities: input.capabilities,
    canManageInvitations: input.canManageInvitations,
    pendingMemberOperation: input.pendingMemberOperation,
    invitationActionState: input.invitationActionState,
    handlers: {
      onChangeRole: input.onChangeRole,
      onRemoveMember: input.onRemoveMember,
      onResendInvite: input.onResendInvite,
      onRevokeInvite: input.onRevokeInvite,
    },
  });

  return (
    <>
      <MembersDirectoryToolbar
        activeFilter={input.activeFilter}
        onSearchValueChange={input.onSearchValueChange}
        searchValue={input.searchValue}
      />

      <Table className="min-w-[48rem]">
        <TableHeader className="bg-muted/60">
          <TableRow className="h-9 border-b">
            {showNameColumn ? (
              <TableHead className="text-foreground py-2 text-xs font-semibold tracking-wide uppercase">
                Name
              </TableHead>
            ) : null}
            <TableHead className="text-foreground py-2 text-xs font-semibold tracking-wide uppercase">
              Email
            </TableHead>
            <TableHead className="text-foreground py-2 text-xs font-semibold tracking-wide uppercase whitespace-nowrap">
              Role
            </TableHead>
            {showInvitationStatusColumn ? (
              <TableHead className="text-foreground py-2 text-xs font-semibold tracking-wide uppercase whitespace-nowrap">
                Status
              </TableHead>
            ) : null}
            {showInvitedByColumn ? (
              <TableHead className="text-foreground py-2 text-xs font-semibold tracking-wide uppercase whitespace-nowrap">
                Invited by
              </TableHead>
            ) : null}
            <TableHead className="text-foreground py-2 text-xs font-semibold tracking-wide uppercase whitespace-nowrap">
              Date
            </TableHead>
            {showExpiresColumn ? (
              <TableHead className="text-foreground py-2 text-xs font-semibold tracking-wide uppercase whitespace-nowrap">
                Expires
              </TableHead>
            ) : null}
            <TableHead className="text-right text-foreground py-2 text-xs font-semibold tracking-wide uppercase whitespace-nowrap">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                className="text-muted-foreground"
                colSpan={input.activeFilter === "members" ? 5 : 7}
              >
                {input.searchValue.length > 0
                  ? "No rows match the current search."
                  : input.activeFilter === "members"
                    ? "No members were found."
                    : "No invitations were found."}
              </TableCell>
            </TableRow>
          ) : null}
          {tableRows.map((row) => {
            return (
              <DirectoryTableRow
                actions={row.actions}
                actionsLabel={row.actionsLabel}
                date={row.date}
                email={row.email}
                key={row.key}
                role={row.role}
                showMemberAvatar={row.showMemberAvatar}
                showNameColumn={showNameColumn}
                showStatusColumn={showInvitationStatusColumn}
                showInvitedByColumn={showInvitedByColumn}
                showExpiresColumn={showExpiresColumn}
                memberAvatar={row.memberAvatar}
                name={row.name}
                status={row.status}
                invitedBy={row.invitedBy}
                expiresAt={row.expiresAt}
                actionFeedback={row.actionFeedback}
                {...(row.actionsContentClassName === undefined
                  ? {}
                  : { actionsContentClassName: row.actionsContentClassName })}
              />
            );
          })}
        </TableBody>
      </Table>
    </>
  );
}
