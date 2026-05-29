import {
  getControlPlaneDatabaseSchema,
  IntegrationBindingKinds,
  SandboxProfileVersionStates,
  type ControlPlaneTransaction,
} from "@mistle/db/control-plane";
import { and, eq, or } from "drizzle-orm";

import { logger } from "../../logger.js";
import { resolveGitCommitSigningPolicy } from "../../sandbox-profiles/services/git-signing-policy.js";
import { GitHubProviderFamily } from "../github-signing.js";

export type GitCommitSigningSyncAction = "enable" | "disable";

export type GitCommitSigningSyncInvariantViolationReason = "mismatched_signing_connection";

export type GitCommitSigningSyncResult = {
  action: GitCommitSigningSyncAction;
  updatedProfileIds: readonly string[];
  invariantViolations: readonly {
    profileId: string;
    version: number;
    reason: GitCommitSigningSyncInvariantViolationReason;
    gitConnectionId: string | null;
    gitCommitSigningIntegrationConnectionId: string | null;
  }[];
};

type CurrentProfileVersionRow = {
  profileId: string;
  version: number;
  gitConnectionId: string | null;
  gitCommitSigningIntegrationConnectionId: string | null;
};

export async function syncProfileGitCommitSigningForIdentityLinking(
  db: ControlPlaneTransaction,
  input: {
    organizationId: string;
    providerFamily: string;
    integrationConnectionId: string;
    action: GitCommitSigningSyncAction;
  },
): Promise<GitCommitSigningSyncResult> {
  return await resolveProfileGitCommitSigningImpact(db, {
    ...input,
    apply: true,
  });
}

export async function previewProfileGitCommitSigningForIdentityLinking(
  db: ControlPlaneTransaction,
  input: {
    organizationId: string;
    providerFamily: string;
    integrationConnectionId: string;
    action: GitCommitSigningSyncAction;
  },
): Promise<GitCommitSigningSyncResult> {
  return await resolveProfileGitCommitSigningImpact(db, {
    ...input,
    apply: false,
  });
}

async function resolveProfileGitCommitSigningImpact(
  db: ControlPlaneTransaction,
  input: {
    organizationId: string;
    providerFamily: string;
    integrationConnectionId: string;
    action: GitCommitSigningSyncAction;
    apply: boolean;
  },
): Promise<GitCommitSigningSyncResult> {
  if (input.providerFamily !== GitHubProviderFamily) {
    return {
      action: input.action,
      updatedProfileIds: [],
      invariantViolations: [],
    };
  }

  return input.action === "enable"
    ? await enableProfileGitCommitSigning(db, input)
    : await disableProfileGitCommitSigning(db, input);
}

async function enableProfileGitCommitSigning(
  db: ControlPlaneTransaction,
  input: {
    organizationId: string;
    integrationConnectionId: string;
    apply: boolean;
  },
): Promise<GitCommitSigningSyncResult> {
  const signingPolicyAllowsSync = await gitCommitSigningPolicyAllowsSync(db, {
    organizationId: input.organizationId,
    integrationConnectionId: input.integrationConnectionId,
    requireExistingProviderConfig: input.apply,
  });
  if (!signingPolicyAllowsSync) {
    return {
      action: "enable",
      updatedProfileIds: [],
      invariantViolations: [],
    };
  }

  const tables = getControlPlaneDatabaseSchema(db);
  const currentVersionRows = await loadCurrentProfileVersionsUsingGitConnection(db, input);
  const updatedProfileIds: string[] = [];
  const invariantViolations: GitCommitSigningSyncResult["invariantViolations"][number][] = [];

  for (const row of currentVersionRows) {
    if (row.gitCommitSigningIntegrationConnectionId === null) {
      if (input.apply) {
        await db
          .update(tables.sandboxProfileVersions)
          .set({
            gitCommitSigningIntegrationConnectionId: input.integrationConnectionId,
          })
          .where(
            and(
              eq(tables.sandboxProfileVersions.sandboxProfileId, row.profileId),
              eq(tables.sandboxProfileVersions.version, row.version),
            ),
          );
      }
      updatedProfileIds.push(row.profileId);
      continue;
    }

    if (row.gitCommitSigningIntegrationConnectionId === input.integrationConnectionId) {
      continue;
    }

    invariantViolations.push({
      profileId: row.profileId,
      version: row.version,
      reason: "mismatched_signing_connection",
      gitConnectionId: row.gitConnectionId,
      gitCommitSigningIntegrationConnectionId: row.gitCommitSigningIntegrationConnectionId,
    });
  }

  if (input.apply) {
    reportGitCommitSigningInvariantViolations(invariantViolations);
  }

  return {
    action: "enable",
    updatedProfileIds: uniqueProfileIds(updatedProfileIds),
    invariantViolations,
  };
}

async function gitCommitSigningPolicyAllowsSync(
  db: ControlPlaneTransaction,
  input: {
    organizationId: string;
    integrationConnectionId: string;
    requireExistingProviderConfig: boolean;
  },
): Promise<boolean> {
  const providerConfig = await db.query.organizationIdentityLinkProviderConfigs.findFirst({
    columns: {
      policy: true,
    },
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.organizationId, input.organizationId),
        whereEq(table.providerFamily, GitHubProviderFamily),
        whereEq(table.integrationConnectionId, input.integrationConnectionId),
      ),
  });

  if (providerConfig === undefined && input.requireExistingProviderConfig) {
    throw new Error(
      `Expected GitHub identity-linking provider config for connection '${input.integrationConnectionId}' before syncing profile Git commit signing.`,
    );
  }

  return (
    resolveGitCommitSigningPolicy({
      policy: providerConfig?.policy ?? null,
      gitCommitSigningIntegrationConnectionId: input.integrationConnectionId,
    }).mode !== "disabled"
  );
}

async function disableProfileGitCommitSigning(
  db: ControlPlaneTransaction,
  input: {
    organizationId: string;
    integrationConnectionId: string;
    apply: boolean;
  },
): Promise<GitCommitSigningSyncResult> {
  const tables = getControlPlaneDatabaseSchema(db);
  const currentVersionRows = await loadCurrentProfileVersionsSigningWithConnection(db, input);
  const updatedProfileIds: string[] = [];
  const invariantViolations: GitCommitSigningSyncResult["invariantViolations"][number][] = [];

  for (const row of currentVersionRows) {
    if (row.gitConnectionId !== input.integrationConnectionId) {
      invariantViolations.push({
        profileId: row.profileId,
        version: row.version,
        reason: "mismatched_signing_connection",
        gitConnectionId: row.gitConnectionId,
        gitCommitSigningIntegrationConnectionId: row.gitCommitSigningIntegrationConnectionId,
      });
      continue;
    }

    if (input.apply) {
      await db
        .update(tables.sandboxProfileVersions)
        .set({
          gitCommitSigningIntegrationConnectionId: null,
        })
        .where(
          and(
            eq(tables.sandboxProfileVersions.sandboxProfileId, row.profileId),
            eq(tables.sandboxProfileVersions.version, row.version),
          ),
        );
    }
    updatedProfileIds.push(row.profileId);
  }

  if (input.apply) {
    reportGitCommitSigningInvariantViolations(invariantViolations);
  }

  return {
    action: "disable",
    updatedProfileIds: uniqueProfileIds(updatedProfileIds),
    invariantViolations,
  };
}

async function loadCurrentProfileVersionsUsingGitConnection(
  db: ControlPlaneTransaction,
  input: {
    organizationId: string;
    integrationConnectionId: string;
  },
): Promise<CurrentProfileVersionRow[]> {
  const tables = getControlPlaneDatabaseSchema(db);

  return await db
    .select({
      profileId: tables.sandboxProfileVersions.sandboxProfileId,
      version: tables.sandboxProfileVersions.version,
      gitConnectionId: tables.sandboxProfileVersionIntegrationBindings.connectionId,
      gitCommitSigningIntegrationConnectionId:
        tables.sandboxProfileVersions.gitCommitSigningIntegrationConnectionId,
    })
    .from(tables.sandboxProfileVersions)
    .innerJoin(
      tables.sandboxProfiles,
      eq(tables.sandboxProfiles.id, tables.sandboxProfileVersions.sandboxProfileId),
    )
    .innerJoin(
      tables.sandboxProfileVersionIntegrationBindings,
      and(
        eq(
          tables.sandboxProfileVersionIntegrationBindings.sandboxProfileId,
          tables.sandboxProfileVersions.sandboxProfileId,
        ),
        eq(
          tables.sandboxProfileVersionIntegrationBindings.sandboxProfileVersion,
          tables.sandboxProfileVersions.version,
        ),
        eq(tables.sandboxProfileVersionIntegrationBindings.kind, IntegrationBindingKinds.GIT),
        eq(
          tables.sandboxProfileVersionIntegrationBindings.connectionId,
          input.integrationConnectionId,
        ),
      ),
    )
    .where(
      and(
        eq(tables.sandboxProfiles.organizationId, input.organizationId),
        currentProfileVersionPredicate(tables),
      ),
    );
}

async function loadCurrentProfileVersionsSigningWithConnection(
  db: ControlPlaneTransaction,
  input: {
    organizationId: string;
    integrationConnectionId: string;
  },
): Promise<CurrentProfileVersionRow[]> {
  const tables = getControlPlaneDatabaseSchema(db);

  return await db
    .select({
      profileId: tables.sandboxProfileVersions.sandboxProfileId,
      version: tables.sandboxProfileVersions.version,
      gitConnectionId: tables.sandboxProfileVersionIntegrationBindings.connectionId,
      gitCommitSigningIntegrationConnectionId:
        tables.sandboxProfileVersions.gitCommitSigningIntegrationConnectionId,
    })
    .from(tables.sandboxProfileVersions)
    .innerJoin(
      tables.sandboxProfiles,
      eq(tables.sandboxProfiles.id, tables.sandboxProfileVersions.sandboxProfileId),
    )
    .leftJoin(
      tables.sandboxProfileVersionIntegrationBindings,
      and(
        eq(
          tables.sandboxProfileVersionIntegrationBindings.sandboxProfileId,
          tables.sandboxProfileVersions.sandboxProfileId,
        ),
        eq(
          tables.sandboxProfileVersionIntegrationBindings.sandboxProfileVersion,
          tables.sandboxProfileVersions.version,
        ),
        eq(tables.sandboxProfileVersionIntegrationBindings.kind, IntegrationBindingKinds.GIT),
      ),
    )
    .where(
      and(
        eq(tables.sandboxProfiles.organizationId, input.organizationId),
        eq(
          tables.sandboxProfileVersions.gitCommitSigningIntegrationConnectionId,
          input.integrationConnectionId,
        ),
        currentProfileVersionPredicate(tables),
      ),
    );
}

function currentProfileVersionPredicate(tables: ReturnType<typeof getControlPlaneDatabaseSchema>) {
  return or(
    eq(tables.sandboxProfileVersions.version, tables.sandboxProfiles.activeVersion),
    eq(tables.sandboxProfileVersions.state, SandboxProfileVersionStates.DRAFT),
  );
}

function uniqueProfileIds(profileIds: readonly string[]): readonly string[] {
  return Array.from(new Set(profileIds));
}

function reportGitCommitSigningInvariantViolations(
  invariantViolations: GitCommitSigningSyncResult["invariantViolations"],
): void {
  if (invariantViolations.length === 0) {
    return;
  }

  logger.error(
    {
      invariantViolations,
    },
    "Git commit signing identity-linking sync encountered invariant violations.",
  );
}
