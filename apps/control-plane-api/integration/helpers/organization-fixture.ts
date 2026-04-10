import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import { invitations, members, users } from "@mistle/db/control-plane";
import { eq } from "drizzle-orm";

import type {
  InvitationStatus,
  OrganizationRole,
} from "../../src/organizations/services/directory-shared.js";
import type { ControlPlaneApiIntegrationFixture } from "../test-context.js";
import type { AuthenticatedSession } from "./auth-session.js";

export type OrganizationActorFactory = {
  email: string;
  name?: string;
};

export type OrganizationMemberSeed = {
  actor: OrganizationActorFactory;
  role: OrganizationRole;
  createdAt: Date;
  name?: string;
  imageObjectKey?: string | null;
};

export type OrganizationInvitationSeed = {
  email: string;
  role: OrganizationRole | null;
  inviter: OrganizationActorFactory;
  status: InvitationStatus | "queued";
  expiresAt: Date;
  createdAt: Date;
};

export type PersistedOrganizationActor = AuthenticatedSession & {
  email: string;
  name?: string;
};

export type PersistedOrganizationMember = {
  actor: PersistedOrganizationActor;
  role: OrganizationRole;
  createdAt: Date;
  name?: string;
  imageObjectKey?: string | null;
};

export type PersistedOrganizationDirectoryFixture = {
  owner: PersistedOrganizationActor;
  members: PersistedOrganizationMember[];
  actorsByEmail: ReadonlyMap<string, PersistedOrganizationActor>;
};

export function buildOrganizationActor(input: OrganizationActorFactory): OrganizationActorFactory {
  return {
    email: input.email,
    ...(input.name === undefined ? {} : { name: input.name }),
  };
}

export function buildOrganizationMemberSeed(input: OrganizationMemberSeed): OrganizationMemberSeed {
  return {
    actor: buildOrganizationActor(input.actor),
    role: input.role,
    createdAt: input.createdAt,
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.imageObjectKey === undefined ? {} : { imageObjectKey: input.imageObjectKey }),
  };
}

export function buildOrganizationInvitationSeed(
  input: OrganizationInvitationSeed,
): OrganizationInvitationSeed {
  return {
    email: input.email,
    role: input.role,
    inviter: buildOrganizationActor(input.inviter),
    status: input.status,
    expiresAt: input.expiresAt,
    createdAt: input.createdAt,
  };
}

export async function createPersistedOrganizationActor(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  actor: OrganizationActorFactory;
}): Promise<PersistedOrganizationActor> {
  const session = await input.fixture.authSession({
    email: input.actor.email,
  });

  if (input.actor.name !== undefined) {
    await updateUserDirectoryProfile({
      db: input.fixture.db,
      userId: session.userId,
      name: input.actor.name,
    });
  }

  return {
    ...session,
    email: input.actor.email,
    ...(input.actor.name === undefined ? {} : { name: input.actor.name }),
  };
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

export async function persistOrganizationMemberSeed(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  actor: PersistedOrganizationActor;
  seed: OrganizationMemberSeed;
}): Promise<PersistedOrganizationMember> {
  await input.db.insert(members).values({
    organizationId: input.organizationId,
    userId: input.actor.userId,
    role: input.seed.role,
    createdAt: input.seed.createdAt,
  });

  await updateUserDirectoryProfile({
    db: input.db,
    userId: input.actor.userId,
    ...(input.seed.name === undefined ? {} : { name: input.seed.name }),
    ...(input.seed.imageObjectKey === undefined
      ? {}
      : { imageObjectKey: input.seed.imageObjectKey }),
  });

  return {
    actor: input.actor,
    role: input.seed.role,
    createdAt: input.seed.createdAt,
    ...(input.seed.name === undefined ? {} : { name: input.seed.name }),
    ...(input.seed.imageObjectKey === undefined
      ? {}
      : { imageObjectKey: input.seed.imageObjectKey }),
  };
}

export async function persistOrganizationInvitationSeed(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  inviter: PersistedOrganizationActor;
  seed: OrganizationInvitationSeed;
}): Promise<void> {
  await input.db.insert(invitations).values({
    organizationId: input.organizationId,
    email: input.seed.email,
    role: input.seed.role,
    inviterId: input.inviter.userId,
    status: input.seed.status,
    expiresAt: input.seed.expiresAt,
    createdAt: input.seed.createdAt,
  });
}

export async function createPersistedOrganizationDirectoryFixture(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  db?: ControlPlaneDatabase;
  owner: OrganizationActorFactory;
  members?: OrganizationMemberSeed[];
  invitations?: OrganizationInvitationSeed[];
}): Promise<PersistedOrganizationDirectoryFixture> {
  const db = input.db ?? input.fixture.db;
  const actorsByEmail = new Map<string, PersistedOrganizationActor>();

  const owner = await ensurePersistedActor({
    fixture: input.fixture,
    actor: buildOrganizationActor(input.owner),
    actorsByEmail,
  });

  const persistedMembers: PersistedOrganizationMember[] = [];
  for (const rawMember of input.members ?? []) {
    const seed = buildOrganizationMemberSeed(rawMember);
    const actor = await ensurePersistedActor({
      fixture: input.fixture,
      actor: seed.actor,
      actorsByEmail,
    });
    persistedMembers.push(
      await persistOrganizationMemberSeed({
        db,
        organizationId: owner.organizationId,
        actor,
        seed,
      }),
    );
  }

  for (const rawInvitation of input.invitations ?? []) {
    const seed = buildOrganizationInvitationSeed(rawInvitation);
    const inviter = await ensurePersistedActor({
      fixture: input.fixture,
      actor: seed.inviter,
      actorsByEmail,
    });
    await persistOrganizationInvitationSeed({
      db,
      organizationId: owner.organizationId,
      inviter,
      seed,
    });
  }

  return {
    owner,
    members: persistedMembers,
    actorsByEmail,
  };
}

async function ensurePersistedActor(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  actor: OrganizationActorFactory;
  actorsByEmail: Map<string, PersistedOrganizationActor>;
}): Promise<PersistedOrganizationActor> {
  const existingActor = input.actorsByEmail.get(input.actor.email);
  if (existingActor !== undefined) {
    return existingActor;
  }

  const persistedActor = await createPersistedOrganizationActor({
    fixture: input.fixture,
    actor: input.actor,
  });
  input.actorsByEmail.set(persistedActor.email, persistedActor);
  return persistedActor;
}
