import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import { invitations, members, users } from "@mistle/db/control-plane";
import { eq } from "drizzle-orm";

import type {
  InvitationStatus,
  OrganizationRole,
} from "../../src/organizations/services/directory-shared.js";
import type { ControlPlaneApiIntegrationFixture } from "../test-context.js";
import type { AuthenticatedSession } from "./auth-session.js";

export async function createOrganizationActor(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  email: string;
  name?: string;
}): Promise<AuthenticatedSession> {
  const session = await input.fixture.authSession({
    email: input.email,
  });

  if (input.name !== undefined) {
    await updateUserDirectoryProfile({
      db: input.fixture.db,
      userId: session.userId,
      name: input.name,
    });
  }

  return session;
}

export async function updateUserDirectoryProfile(input: {
  db: ControlPlaneDatabase;
  userId: string;
  name?: string;
  imageObjectKey?: string | null;
}): Promise<void> {
  const update: {
    name?: string;
    imageObjectKey?: string | null;
  } = {};

  if (input.name !== undefined) {
    update.name = input.name;
  }
  if (input.imageObjectKey !== undefined) {
    update.imageObjectKey = input.imageObjectKey;
  }

  if (Object.keys(update).length === 0) {
    return;
  }

  await input.db.update(users).set(update).where(eq(users.id, input.userId));
}

export async function seedOrganizationMember(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  userId: string;
  role: OrganizationRole;
  createdAt: Date;
  name?: string;
  imageObjectKey?: string | null;
}): Promise<void> {
  await input.db.insert(members).values({
    organizationId: input.organizationId,
    userId: input.userId,
    role: input.role,
    createdAt: input.createdAt,
  });

  await updateUserDirectoryProfile({
    db: input.db,
    userId: input.userId,
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.imageObjectKey === undefined ? {} : { imageObjectKey: input.imageObjectKey }),
  });
}

export async function seedOrganizationInvitation(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  email: string;
  role: OrganizationRole | null;
  inviterId: string;
  status: InvitationStatus | "queued";
  expiresAt: Date;
  createdAt: Date;
}): Promise<void> {
  await input.db.insert(invitations).values({
    organizationId: input.organizationId,
    email: input.email,
    role: input.role,
    inviterId: input.inviterId,
    status: input.status,
    expiresAt: input.expiresAt,
    createdAt: input.createdAt,
  });
}
