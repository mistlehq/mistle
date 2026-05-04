import {
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { DefaultSandboxWorkspaceDir } from "@mistle/integrations-core";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type { CreateSandboxProfilesServiceInput } from "./types.js";

const GitBindingConfigSchema = z.looseObject({
  repositories: z.array(z.string().min(1)),
});

export type SandboxProfileRepositoryOption = {
  id: string;
  label: string;
  path: string;
};

export function toRepositoryWorkspacePath(repository: string): string {
  return `${DefaultSandboxWorkspaceDir}/${repository}`;
}

export function toRepositoryOptions(input: {
  gitBindings: ReadonlyArray<{
    config: Record<string, unknown>;
  }>;
}): SandboxProfileRepositoryOption[] {
  const repositoryOptionsById = new Map<string, SandboxProfileRepositoryOption>();

  for (const gitBinding of input.gitBindings) {
    const parsedConfig = GitBindingConfigSchema.parse(gitBinding.config);

    for (const repository of parsedConfig.repositories) {
      const path = toRepositoryWorkspacePath(repository);
      repositoryOptionsById.set(repository, {
        id: repository,
        label: repository,
        path,
      });
    }
  }

  return [...repositoryOptionsById.values()].sort((left, right) =>
    left.label.localeCompare(right.label),
  );
}

export async function listProfileVersionRepositoryOptions(
  { db }: Pick<CreateSandboxProfilesServiceInput, "db">,
  input: {
    organizationId: string;
    profileId: string;
    profileVersion: number;
  },
): Promise<SandboxProfileRepositoryOption[]> {
  const tables = getControlPlaneDatabaseSchema(db);

  const gitBindings = await db
    .select({
      config: tables.sandboxProfileVersionIntegrationBindings.config,
    })
    .from(tables.sandboxProfileVersionIntegrationBindings)
    .innerJoin(
      tables.integrationConnections,
      eq(
        tables.integrationConnections.id,
        tables.sandboxProfileVersionIntegrationBindings.connectionId,
      ),
    )
    .innerJoin(
      tables.integrationTargets,
      eq(tables.integrationTargets.targetKey, tables.integrationConnections.targetKey),
    )
    .where(
      and(
        eq(tables.sandboxProfileVersionIntegrationBindings.sandboxProfileId, input.profileId),
        eq(
          tables.sandboxProfileVersionIntegrationBindings.sandboxProfileVersion,
          input.profileVersion,
        ),
        eq(tables.sandboxProfileVersionIntegrationBindings.kind, IntegrationBindingKinds.GIT),
        eq(tables.integrationConnections.organizationId, input.organizationId),
        eq(tables.integrationConnections.status, IntegrationConnectionStatuses.ACTIVE),
        eq(tables.integrationTargets.enabled, true),
      ),
    );

  return toRepositoryOptions({
    gitBindings,
  });
}
