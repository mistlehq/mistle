import { z } from "zod";

export type InvitationDetails = {
  id: string;
  email: string;
  role: string;
  organizationId: string;
  inviterId: string;
  status: string;
  expiresAt: string;
  organizationName: string | null;
  inviterEmail: string | null;
};

const OrganizationRecordSchema = z
  .object({
    name: z.string().optional(),
  })
  .catchall(z.unknown());

const InviterRecordSchema = z
  .object({
    email: z.string().optional(),
    user: z
      .object({
        email: z.string().optional(),
      })
      .optional(),
  })
  .catchall(z.unknown());

const InvitationRecordSchema = z
  .object({
    id: z.string().optional(),
    email: z.string().optional(),
    role: z.string().optional(),
    organizationId: z.string().optional(),
    inviterId: z.string().optional(),
    status: z.string().optional(),
    expiresAt: z.string().optional(),
    organizationName: z.string().optional(),
    inviterEmail: z.string().optional(),
    organization: OrganizationRecordSchema.optional(),
    inviter: InviterRecordSchema.optional(),
  })
  .catchall(z.unknown());

const InvitationDetailsEnvelopeSchema = InvitationRecordSchema.extend({
  invitation: InvitationRecordSchema.optional(),
  organization: OrganizationRecordSchema.optional(),
  inviter: InviterRecordSchema.optional(),
});

const InvitationErrorSchema = z
  .object({
    status: z.number().optional(),
    statusCode: z.number().optional(),
    message: z.string().optional(),
  })
  .catchall(z.unknown());

type InvitationDetailsEnvelope = z.infer<typeof InvitationDetailsEnvelopeSchema>;
type OrganizationRecord = z.infer<typeof OrganizationRecordSchema>;
type InviterRecord = z.infer<typeof InviterRecordSchema>;

function readHttpStatus(error: unknown): number | null {
  const parsedError = InvitationErrorSchema.safeParse(error);
  if (!parsedError.success) {
    return null;
  }

  if (parsedError.data.status !== undefined) {
    return parsedError.data.status;
  }

  return parsedError.data.statusCode ?? null;
}

function resolveOrganizationRecord(envelope: InvitationDetailsEnvelope): OrganizationRecord | null {
  if (envelope.organization !== undefined) {
    return envelope.organization;
  }

  return envelope.invitation?.organization ?? null;
}

function resolveInviterRecord(envelope: InvitationDetailsEnvelope): InviterRecord | null {
  if (envelope.inviter !== undefined) {
    return envelope.inviter;
  }

  return envelope.invitation?.inviter ?? null;
}

export function parseInvitationDetails(value: unknown): InvitationDetails | null {
  const parsedEnvelope = InvitationDetailsEnvelopeSchema.safeParse(value);
  if (!parsedEnvelope.success) {
    return null;
  }

  const envelope = parsedEnvelope.data;
  const invitation = envelope.invitation ?? envelope;
  const organization = resolveOrganizationRecord(envelope);
  const inviter = resolveInviterRecord(envelope);

  const id = invitation.id ?? envelope.id;
  const email = invitation.email ?? envelope.email;
  const role = invitation.role ?? envelope.role;
  const organizationId = invitation.organizationId ?? envelope.organizationId;
  const inviterId = invitation.inviterId ?? envelope.inviterId;
  const status = invitation.status ?? envelope.status;
  const expiresAt = invitation.expiresAt ?? envelope.expiresAt;
  const organizationName: string | null =
    invitation.organizationName ?? envelope.organizationName ?? organization?.name ?? null;
  const inviterEmail: string | null =
    invitation.inviterEmail ??
    envelope.inviterEmail ??
    inviter?.email ??
    inviter?.user?.email ??
    null;

  if (
    id === undefined ||
    email === undefined ||
    role === undefined ||
    organizationId === undefined ||
    inviterId === undefined ||
    status === undefined ||
    expiresAt === undefined
  ) {
    return null;
  }

  return {
    id,
    email,
    role,
    organizationId,
    inviterId,
    status,
    expiresAt,
    organizationName,
    inviterEmail,
  };
}

function readErrorMessage(error: unknown): string | null {
  const parsedError = InvitationErrorSchema.safeParse(error);
  if (!parsedError.success) {
    return null;
  }

  return parsedError.data.message ?? null;
}

export function toInvitationFetchErrorMessage(error: unknown): string {
  const status = readHttpStatus(error);
  if (status === 401) {
    return "Please sign in to continue.";
  }
  if (status === 403) {
    return "This invitation belongs to a different account.";
  }
  if (status === 400) {
    return "This invitation is invalid, expired, or no longer pending.";
  }

  return readErrorMessage(error) ?? "Unable to load invitation details.";
}

export function isInvitationFetchDifferentAccountError(error: unknown): boolean {
  return readHttpStatus(error) === 403;
}

export function toInvitationMutationErrorMessage(
  error: unknown,
  action: "accept" | "reject",
): string {
  const status = readHttpStatus(error);
  if (status === 401) {
    return "Please sign in to continue.";
  }
  if (status === 403) {
    return "You are not allowed to modify this invitation.";
  }
  if (status === 400) {
    return "This invitation is no longer available.";
  }

  const defaultMessage =
    action === "accept" ? "Unable to accept invitation." : "Unable to decline invitation.";
  return readErrorMessage(error) ?? defaultMessage;
}

export function formatInvitationRole(role: string): string {
  if (role === "owner") {
    return "Owner";
  }
  if (role === "admin") {
    return "Admin";
  }
  if (role === "member") {
    return "Member";
  }
  return role;
}
