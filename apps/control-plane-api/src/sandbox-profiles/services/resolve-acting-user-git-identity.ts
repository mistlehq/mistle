import {
  OrganizationIdentityLinkProviderConfigStatus,
  UserExternalPrincipalStatuses,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import { z } from "zod";

const GitHubProviderFamily = "github";

const GitHubPrincipalProfileSchema = z
  .object({
    login: z.string().min(1),
    displayName: z.string().min(1).optional(),
    email: z.email().optional(),
  })
  .loose();

export type SandboxActingUser = {
  userId: string;
};

export type SandboxGitIdentity = {
  name: string;
  email: string;
};

export async function resolveActingUserGitIdentity(
  db: ControlPlaneDatabase,
  input: {
    organizationId: string;
    actingUser?: SandboxActingUser;
  },
): Promise<SandboxGitIdentity | undefined> {
  const actingUser = input.actingUser;
  if (actingUser === undefined) {
    return undefined;
  }

  const githubProviderConfig = await db.query.organizationIdentityLinkProviderConfigs.findFirst({
    columns: {
      id: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.organizationId, input.organizationId),
        eq(table.providerFamily, GitHubProviderFamily),
        eq(table.status, OrganizationIdentityLinkProviderConfigStatus.ACTIVE),
      ),
  });

  if (githubProviderConfig === undefined) {
    return undefined;
  }

  const githubPrincipal = await db.query.userExternalPrincipals.findFirst({
    columns: {
      profile: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.organizationId, input.organizationId),
        eq(table.userId, actingUser.userId),
        eq(table.providerFamily, GitHubProviderFamily),
        eq(table.organizationProviderConfigId, githubProviderConfig.id),
        eq(table.status, UserExternalPrincipalStatuses.ACTIVE),
      ),
  });

  if (githubPrincipal?.profile === null || githubPrincipal?.profile === undefined) {
    return undefined;
  }

  const parsedProfile = GitHubPrincipalProfileSchema.safeParse(githubPrincipal.profile);
  if (!parsedProfile.success) {
    return undefined;
  }

  const email = parsedProfile.data.email?.trim();
  if (email === undefined || email.length === 0) {
    return undefined;
  }

  const displayName = parsedProfile.data.displayName?.trim();
  const name =
    displayName === undefined || displayName.length === 0 ? parsedProfile.data.login : displayName;

  return {
    name,
    email,
  };
}
