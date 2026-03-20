import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@mistle/ui";
import { useMemo } from "react";

import { InvitationDetailsDialog } from "./invitation-details-dialog.js";
import type { MembershipCapabilities, SettingsInvitation, SettingsMember } from "./members-api.js";
import {
  type MembersDirectoryInvitationActionState,
  type MembersDirectoryPendingMemberOperation,
} from "./members-directory-model.js";
import { MembersDirectoryToolbar } from "./members-directory-toolbar.js";
import { DirectoryTableRow } from "./members-table-rows.js";
import { buildMembersDirectoryTableRowViewModels } from "./members-table-view-model.js";
import { useMembersDirectoryTableState } from "./use-members-directory-table-state.js";

export function MembersDirectoryTable(input: {
  members: SettingsMember[];
  invitations: SettingsInvitation[];
  capabilities: MembershipCapabilities | null;
  canManageInvitations: boolean;
  pendingMemberOperation: MembersDirectoryPendingMemberOperation;
  invitationActionState: MembersDirectoryInvitationActionState;
  resolveInviterDisplayName: (inviterId: string) => string;
  onChangeRole: (member: SettingsMember) => void;
  onRemoveMember: (member: SettingsMember) => void;
  onRevokeInvite: (invitation: SettingsInvitation) => void;
  onResendInvite: (invitation: SettingsInvitation) => void;
}): React.JSX.Element {
  const {
    selectedInvitationForDetails,
    setSelectedInvitationForDetails,
    activeFilter,
    setActiveFilter,
    searchValue,
    setSearchValue,
    hasRows,
    visibleRows,
  } = useMembersDirectoryTableState({
    members: input.members,
    invitations: input.invitations,
  });
  const tableRows = useMemo(
    () =>
      buildMembersDirectoryTableRowViewModels({
        rows: visibleRows,
        capabilities: input.capabilities,
        canManageInvitations: input.canManageInvitations,
        pendingMemberOperation: input.pendingMemberOperation,
        invitationActionState: input.invitationActionState,
        handlers: {
          onChangeRole: input.onChangeRole,
          onRemoveMember: input.onRemoveMember,
          onViewInvitationDetails: setSelectedInvitationForDetails,
          onResendInvite: input.onResendInvite,
          onRevokeInvite: input.onRevokeInvite,
        },
      }),
    [
      visibleRows,
      input.capabilities,
      input.canManageInvitations,
      input.pendingMemberOperation,
      input.invitationActionState,
      input.onChangeRole,
      input.onRemoveMember,
      input.onResendInvite,
      input.onRevokeInvite,
      setSelectedInvitationForDetails,
    ],
  );

  return (
    <>
      <MembersDirectoryToolbar
        activeFilter={activeFilter}
        onFilterChange={setActiveFilter}
        onSearchValueChange={setSearchValue}
        searchValue={searchValue}
      />

      <Table className="min-w-[48rem] table-fixed">
        <colgroup>
          <col className="w-[26%]" />
          <col className="w-[30%]" />
          <col className="w-[14%]" />
          <col className="w-[14%]" />
          <col className="w-36" />
        </colgroup>
        <TableHeader className="bg-muted/60">
          <TableRow className="h-9 border-b">
            <TableHead className="text-foreground py-2 text-xs font-semibold tracking-wide uppercase">
              Name
            </TableHead>
            <TableHead className="text-foreground py-2 text-xs font-semibold tracking-wide uppercase">
              Email
            </TableHead>
            <TableHead className="text-foreground py-2 text-xs font-semibold tracking-wide uppercase">
              Status
            </TableHead>
            <TableHead className="text-foreground py-2 text-xs font-semibold tracking-wide uppercase">
              Date
            </TableHead>
            <TableHead className="text-right text-foreground py-2 text-xs font-semibold tracking-wide uppercase">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleRows.length === 0 ? (
            <TableRow>
              <TableCell className="text-muted-foreground" colSpan={5}>
                {hasRows
                  ? "No rows match the current search or filter."
                  : "No members or invitations were found."}
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
                name={row.name}
                status={row.status}
                actionFeedback={row.actionFeedback}
                {...(row.actionsContentClassName === undefined
                  ? {}
                  : { actionsContentClassName: row.actionsContentClassName })}
              />
            );
          })}
        </TableBody>
      </Table>

      <InvitationDetailsDialog
        invitation={selectedInvitationForDetails}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setSelectedInvitationForDetails(null);
          }
        }}
        open={selectedInvitationForDetails !== null}
        resolveInviterDisplayName={input.resolveInviterDisplayName}
      />
    </>
  );
}
