import type { MembershipCapabilities, SettingsInvitation, SettingsMember } from "./members-api.js";
import type { MembersTableAction } from "./members-table-rows.js";

import {
  buildMembersDirectoryRowActionDescriptors,
  directoryRowActionsContentClassName,
  directoryRowActionsLabel,
  formatMembersDirectoryRow,
  resolveInvitationActionFeedback,
  type MembersDirectoryActionFeedback,
  type MembersDirectoryActionDescriptor,
  type MembersDirectoryInvitationActionState,
  type MembersDirectoryPendingMemberOperation,
  type MembersDirectoryRow,
} from "./members-directory-model.js";

export type MembersDirectoryTableRowViewModel = {
  key: string;
  name: string;
  email: string;
  status: string;
  date: string;
  actionsLabel: string;
  actionsContentClassName?: string;
  actionFeedback: MembersDirectoryActionFeedback | null;
  actions: MembersTableAction[];
};

type MembersDirectoryActionHandlers = {
  onChangeRole: (member: SettingsMember) => void;
  onRemoveMember: (member: SettingsMember) => void;
  onViewInvitationDetails: (invitation: SettingsInvitation) => void;
  onResendInvite: (invitation: SettingsInvitation) => void;
  onRevokeInvite: (invitation: SettingsInvitation) => void;
};

function toMembersTableAction(input: {
  descriptor: MembersDirectoryActionDescriptor;
  handlers: MembersDirectoryActionHandlers;
}): MembersTableAction {
  const descriptor = input.descriptor;

  const onSelect = (): void => {
    switch (descriptor.key) {
      case "change_role":
        input.handlers.onChangeRole(descriptor.member);
        return;
      case "remove_member":
        input.handlers.onRemoveMember(descriptor.member);
        return;
      case "view_details":
        input.handlers.onViewInvitationDetails(descriptor.invitation);
        return;
      case "resend_invite":
        input.handlers.onResendInvite(descriptor.invitation);
        return;
      case "revoke_invitation":
        input.handlers.onRevokeInvite(descriptor.invitation);
        return;
      default:
        descriptor satisfies never;
    }
  };

  return {
    key: descriptor.key,
    label: descriptor.label,
    disabled: descriptor.disabled,
    destructive: descriptor.destructive,
    onSelect,
  };
}

export function buildMembersDirectoryTableRowViewModels(input: {
  rows: MembersDirectoryRow[];
  capabilities: MembershipCapabilities | null;
  canManageInvitations: boolean;
  pendingMemberOperation: MembersDirectoryPendingMemberOperation;
  invitationActionState: MembersDirectoryInvitationActionState;
  handlers: MembersDirectoryActionHandlers;
}): MembersDirectoryTableRowViewModel[] {
  return input.rows.map((row) => {
    const formattedRow = formatMembersDirectoryRow(row);
    const descriptors = buildMembersDirectoryRowActionDescriptors({
      row,
      capabilities: input.capabilities,
      canManageInvitations: input.canManageInvitations,
      pendingMemberOperation: input.pendingMemberOperation,
      invitationActionState: input.invitationActionState,
    });
    const actions = descriptors.map((descriptor) =>
      toMembersTableAction({
        descriptor,
        handlers: input.handlers,
      }),
    );
    const actionFeedback =
      row.kind === "invitation"
        ? resolveInvitationActionFeedback({
            invitationId: row.invitation.id,
            invitationActionState: input.invitationActionState,
          })
        : null;
    const actionsContentClassName = directoryRowActionsContentClassName(row);

    return {
      key: `${row.kind}:${row.id}`,
      name: formattedRow.name,
      email: formattedRow.email,
      status: formattedRow.status,
      date: formattedRow.date,
      actionsLabel: directoryRowActionsLabel(row),
      actionFeedback,
      actions,
      ...(actionsContentClassName === undefined ? {} : { actionsContentClassName }),
    };
  });
}
