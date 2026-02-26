import { authClient } from "../../../lib/auth/client.js";
import { createMembersInvitationsService } from "./members-invitations-service-core.js";

export {
  createMembersInvitationsService,
  type MembersInvitationsFetchClient,
} from "./members-invitations-service-core.js";

const membersInvitationsService = createMembersInvitationsService(authClient);

export const listInvitations = membersInvitationsService.listInvitations;
export const inviteMember = membersInvitationsService.inviteMember;
export const revokeInvitation = membersInvitationsService.revokeInvitation;
