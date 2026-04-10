import {
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
  integrationConnections,
  integrationTargets,
  sandboxProfileVersionIntegrationBindings,
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
  const gitBindings = await db
    .select({
      config: sandboxProfileVersionIntegrationBindings.config,
    })
    .from(sandboxProfileVersionIntegrationBindings)
    .innerJoin(
      integrationConnections,
      eq(integrationConnections.id, sandboxProfileVersionIntegrationBindings.connectionId),
    )
    .innerJoin(
      integrationTargets,
      eq(integrationTargets.targetKey, integrationConnections.targetKey),
    )
    .where(
      and(
        eq(sandboxProfileVersionIntegrationBindings.sandboxProfileId, input.profileId),
        eq(sandboxProfileVersionIntegrationBindings.sandboxProfileVersion, input.profileVersion),
        eq(sandboxProfileVersionIntegrationBindings.kind, IntegrationBindingKinds.GIT),
        eq(integrationConnections.organizationId, input.organizationId),
        eq(integrationConnections.status, IntegrationConnectionStatuses.ACTIVE),
        eq(integrationTargets.enabled, true),
      ),
    );

  return toRepositoryOptions({
    gitBindings,
  });
}
