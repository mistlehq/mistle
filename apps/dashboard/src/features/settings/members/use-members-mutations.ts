import { systemSleeper } from "@mistle/time";
import { useMutation, type QueryClient } from "@tanstack/react-query";
import { type Dispatch, type SetStateAction } from "react";

import type { OrganizationRole, SettingsInvitation, SettingsMember } from "./members-api.js";
import type { RoleChangeDialogState } from "./members-capability-policy.js";
import type {
  MembersDirectoryInvitationActionState,
  MembersDirectoryPendingMemberOperation,
} from "./members-directory-model.js";
import type { MembersQueryKeys } from "./members-query-keys.js";
import type { MembersSettingsApi } from "./members-settings-api.js";

import { toMembersErrorMessage } from "./members-status-messages.js";

const INVITATION_FEEDBACK_DURATION_MS = 3000;

function useMembersMutation<TVariables>(input: {
  mutationFn: (variables: TVariables) => Promise<unknown>;
  invalidate: Array<readonly [string, string, string]>;
  queryClient: QueryClient;
  onSuccess?: (variables: TVariables) => void;
  onError?: (error: unknown) => void;
  onBeforeInvalidate?: () => Promise<void>;
  onAfterInvalidate?: () => void;
  onSettled?: () => void;
}) {
  return useMutation({
    mutationFn: input.mutationFn,
    onSuccess: async (_data, variables) => {
      input.onSuccess?.(variables);
      await input.onBeforeInvalidate?.();
      await Promise.all(
        input.invalidate.map((queryKey) =>
          input.queryClient.invalidateQueries({
            queryKey,
          }),
        ),
      );
      input.onAfterInvalidate?.();
    },
    onError: (error: unknown) => {
      input.onError?.(error);
    },
    onSettled: () => {
      input.onSettled?.();
    },
  });
}

export function useMembersMutations(input: {
  organizationId: string;
  api: MembersSettingsApi;
  queryClient: QueryClient;
  queryKeys: MembersQueryKeys;
  roleChangeDialog: RoleChangeDialogState | null;
  setRoleChangeDialog: Dispatch<SetStateAction<RoleChangeDialogState | null>>;
  setRoleUpdateErrorMessage: Dispatch<SetStateAction<string | null>>;
  setPendingMemberOperation: Dispatch<SetStateAction<MembersDirectoryPendingMemberOperation>>;
  setInvitationActionState: Dispatch<SetStateAction<MembersDirectoryInvitationActionState>>;
}): {
  isUpdatingRole: boolean;
  onSaveRole: () => void;
  onRemoveMember: (member: SettingsMember) => void;
  onResendInvite: (invitation: SettingsInvitation) => void;
  onRevokeInvite: (invitation: SettingsInvitation) => void;
  onInviteCompleted: () => Promise<void>;
} {
  const resendInviteMutation = useMembersMutation({
    mutationFn: async (invitation: SettingsInvitation) =>
      input.api.inviteMember({
        organizationId: input.organizationId,
        email: invitation.email,
        role: invitation.role,
        resend: true,
      }),
    invalidate: [input.queryKeys.invitations],
    queryClient: input.queryClient,
    onSuccess: (invitation) => {
      input.setInvitationActionState({
        invitationId: invitation.id,
        action: "resend_invite",
        phase: "completed",
      });
    },
    onBeforeInvalidate: async () => {
      await systemSleeper.sleep(INVITATION_FEEDBACK_DURATION_MS);
    },
    onAfterInvalidate: () => {
      input.setInvitationActionState(null);
    },
    onError: () => {
      input.setInvitationActionState(null);
    },
  });

  const revokeInviteMutation = useMembersMutation({
    mutationFn: async (invitation: SettingsInvitation) =>
      input.api.revokeInvitation({
        invitationId: invitation.id,
      }),
    invalidate: [input.queryKeys.invitations],
    queryClient: input.queryClient,
    onSuccess: (invitation) => {
      input.setInvitationActionState({
        invitationId: invitation.id,
        action: "revoke_invitation",
        phase: "completed",
      });
    },
    onBeforeInvalidate: async () => {
      await systemSleeper.sleep(INVITATION_FEEDBACK_DURATION_MS);
    },
    onAfterInvalidate: () => {
      input.setInvitationActionState(null);
    },
    onError: () => {
      input.setInvitationActionState(null);
    },
  });

  const updateRoleMutation = useMembersMutation({
    mutationFn: async (nextValue: { memberId: string; role: OrganizationRole }) =>
      input.api.updateMemberRole({
        organizationId: input.organizationId,
        memberId: nextValue.memberId,
        role: nextValue.role,
      }),
    invalidate: [input.queryKeys.members, input.queryKeys.capabilities],
    queryClient: input.queryClient,
    onSuccess: () => {
      input.setRoleUpdateErrorMessage(null);
      input.setRoleChangeDialog(null);
    },
    onError: (error) => {
      input.setRoleUpdateErrorMessage(toMembersErrorMessage(error, "Could not update role"));
    },
    onSettled: () => {
      input.setPendingMemberOperation(null);
    },
  });

  const removeMemberMutation = useMembersMutation({
    mutationFn: async (member: SettingsMember) =>
      input.api.removeMember({
        organizationId: input.organizationId,
        memberIdOrEmail: member.id,
      }),
    invalidate: [input.queryKeys.members, input.queryKeys.capabilities],
    queryClient: input.queryClient,
    onSettled: () => {
      input.setPendingMemberOperation(null);
    },
  });

  return {
    isUpdatingRole: updateRoleMutation.isPending,
    onSaveRole: () => {
      if (input.roleChangeDialog === null) {
        return;
      }

      input.setPendingMemberOperation({
        kind: "change_role",
        memberId: input.roleChangeDialog.member.id,
      });
      updateRoleMutation.mutate({
        memberId: input.roleChangeDialog.member.id,
        role: input.roleChangeDialog.selectedRole,
      });
    },
    onRemoveMember: (member) => {
      input.setPendingMemberOperation({
        kind: "remove_member",
        memberId: member.id,
      });
      removeMemberMutation.mutate(member);
    },
    onResendInvite: (invitation) => {
      input.setInvitationActionState({
        invitationId: invitation.id,
        action: "resend_invite",
        phase: "pending",
      });
      resendInviteMutation.mutate(invitation);
    },
    onRevokeInvite: (invitation) => {
      input.setInvitationActionState({
        invitationId: invitation.id,
        action: "revoke_invitation",
        phase: "pending",
      });
      revokeInviteMutation.mutate(invitation);
    },
    onInviteCompleted: async () => {
      await Promise.all([
        input.queryClient.invalidateQueries({ queryKey: input.queryKeys.members }),
        input.queryClient.invalidateQueries({ queryKey: input.queryKeys.invitations }),
        input.queryClient.invalidateQueries({ queryKey: input.queryKeys.capabilities }),
      ]);
    },
  };
}
