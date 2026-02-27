import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { MembershipCapabilities, SettingsInvitation, SettingsMember } from "./members-api.js";
import type { RoleChangeDialogState } from "./members-capability-policy.js";
import { buildRoleChangeDialogState, canManageInvitations } from "./members-capability-policy.js";
import type {
  MembersDirectoryInvitationActionState,
  MembersDirectoryPendingMemberOperation,
} from "./members-directory-model.js";
import { parseRoleSelectValue } from "./members-formatters.js";
import { buildMembersQueryKeys } from "./members-query-keys.js";
import { defaultMembersSettingsApi, type MembersSettingsApi } from "./members-settings-api.js";
import { toMembersErrorMessage } from "./members-status-messages.js";
import { useMembersMutations } from "./use-members-mutations.js";
import { useMembersQueries } from "./use-members-queries.js";

type UseOrganizationMembersSettingsState = {
  organizationId: string;
  api?: MembersSettingsApi;
};

type UseOrganizationMembersSettingsStateResult = {
  inviteDialogOpen: boolean;
  setInviteDialogOpen: (nextOpen: boolean) => void;
  roleChangeDialog: RoleChangeDialogState | null;
  capabilitiesQuery: ReturnType<typeof useMembersQueries>["capabilitiesQuery"];
  membersQuery: ReturnType<typeof useMembersQueries>["membersQuery"];
  invitationsQuery: ReturnType<typeof useMembersQueries>["invitationsQuery"];
  capabilities: MembershipCapabilities | null;
  members: SettingsMember[];
  invitations: SettingsInvitation[];
  canManageInvitations: boolean;
  inviteMembersDisabled: boolean;
  pendingMemberOperation: MembersDirectoryPendingMemberOperation;
  invitationActionState: MembersDirectoryInvitationActionState;
  isUpdatingRole: boolean;
  roleUpdateErrorMessage: string | null;
  retryMembersAndInvitations: () => void;
  onRetryCapabilities: () => void;
  onChangeRole: (member: SettingsMember) => void;
  onRoleDialogOpenChange: (nextOpen: boolean) => void;
  onRoleSelectValueChange: (nextRoleValue: string | null) => void;
  onSaveRole: () => void;
  onRemoveMember: (member: SettingsMember) => void;
  onResendInvite: (invitation: SettingsInvitation) => void;
  onRevokeInvite: (invitation: SettingsInvitation) => void;
  resolveInviterDisplayName: (inviterId: string) => string;
  onInviteCompleted: () => Promise<void>;
};

export function useOrganizationMembersSettingsState(
  input: UseOrganizationMembersSettingsState,
): UseOrganizationMembersSettingsStateResult {
  const queryClient = useQueryClient();
  const api = input.api ?? defaultMembersSettingsApi;

  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [roleChangeDialog, setRoleChangeDialog] = useState<RoleChangeDialogState | null>(null);
  const [pendingMemberOperation, setPendingMemberOperation] =
    useState<MembersDirectoryPendingMemberOperation>(null);
  const [invitationActionState, setInvitationActionState] =
    useState<MembersDirectoryInvitationActionState>(null);
  const [roleUpdateErrorMessage, setRoleUpdateErrorMessage] = useState<string | null>(null);

  const queryKeys = buildMembersQueryKeys(input.organizationId);
  const queries = useMembersQueries({
    organizationId: input.organizationId,
    api,
    queryKeys,
  });
  const mutations = useMembersMutations({
    organizationId: input.organizationId,
    api,
    queryClient,
    queryKeys,
    roleChangeDialog,
    setRoleChangeDialog,
    setRoleUpdateErrorMessage,
    setPendingMemberOperation,
    setInvitationActionState,
  });

  const inviteMembersDisabled =
    queries.capabilitiesQuery.isError || !canManageInvitations(queries.capabilities);

  return {
    inviteDialogOpen,
    setInviteDialogOpen,
    roleChangeDialog,
    capabilitiesQuery: queries.capabilitiesQuery,
    membersQuery: queries.membersQuery,
    invitationsQuery: queries.invitationsQuery,
    capabilities: queries.capabilities,
    members: queries.members,
    invitations: queries.invitations,
    canManageInvitations: canManageInvitations(queries.capabilities),
    inviteMembersDisabled,
    pendingMemberOperation,
    invitationActionState,
    isUpdatingRole: mutations.isUpdatingRole,
    roleUpdateErrorMessage,
    retryMembersAndInvitations: () => {
      void Promise.all([queries.membersQuery.refetch(), queries.invitationsQuery.refetch()]);
    },
    onRetryCapabilities: () => {
      void queries.capabilitiesQuery.refetch();
    },
    onChangeRole: (member) => {
      const nextRoleChangeDialog = buildRoleChangeDialogState({
        capabilities: queries.capabilities,
        member,
      });
      if (nextRoleChangeDialog === null) {
        return;
      }

      setRoleUpdateErrorMessage(null);
      setRoleChangeDialog(nextRoleChangeDialog);
    },
    onRoleDialogOpenChange: (nextOpen) => {
      if (!nextOpen && !mutations.isUpdatingRole) {
        setRoleUpdateErrorMessage(null);
        setRoleChangeDialog(null);
      }
    },
    onRoleSelectValueChange: (nextRoleValue) => {
      const parsedRole = parseRoleSelectValue(nextRoleValue);
      if (parsedRole === null) {
        return;
      }

      setRoleUpdateErrorMessage(null);
      setRoleChangeDialog((currentValue) => {
        if (currentValue === null) {
          return null;
        }

        return {
          ...currentValue,
          selectedRole: parsedRole,
        };
      });
    },
    onSaveRole: mutations.onSaveRole,
    onRemoveMember: mutations.onRemoveMember,
    onResendInvite: mutations.onResendInvite,
    onRevokeInvite: mutations.onRevokeInvite,
    resolveInviterDisplayName: (inviterId) =>
      queries.inviterDisplayNames.get(inviterId) ?? inviterId,
    onInviteCompleted: mutations.onInviteCompleted,
  };
}

export function toMembersLoadErrorMessage(input: {
  membersError: unknown;
  invitationsError: unknown;
  hasMembersError: boolean;
}): string {
  return input.hasMembersError
    ? toMembersErrorMessage(input.membersError, "Failed to load members.")
    : toMembersErrorMessage(input.invitationsError, "Failed to load invitations.");
}
