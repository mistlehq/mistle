import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import {
  getControlPlaneDatabaseSchema,
  type ControlPlaneDatabase,
  type SkillsSourceRepo,
  type SkillsSourceRepoSkill,
} from "@mistle/db/control-plane";
import {
  SandboxInstancePurposes,
  type SandboxInstanceSource,
  type SandboxInstanceStarterKind,
} from "@mistle/db/data-plane";
import type { ConnectionTokenConfig } from "@mistle/gateway-connection-auth";
import type { CompiledRuntimePlan } from "@mistle/integrations-core";
import type { SandboxProvider } from "@mistle/sandbox";
import { ExecStreamClient, SandboxSessionTransport } from "@mistle/sandbox-session-client";
import { createNodeSandboxSessionRuntime } from "@mistle/sandbox-session-client/node";
import { sql } from "drizzle-orm";
import { z } from "zod";

import { mintConnectionToken } from "../../internal/sandbox-runtime/services/mint-connection-token.js";

const SkillsDiscoverCommandTimeoutMs = 30_000;
const SkillsDiscoverCommandOutputBytes = 1_000_000;

const SkillsDiscoverOutputSchema = z
  .object({
    commitSha: z.string().min(1),
    skills: z.array(
      z
        .object({
          name: z.string().min(1),
          description: z.string(),
          relativePath: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();

export type SkillsDiscoverOutput = z.infer<typeof SkillsDiscoverOutputSchema>;

export type SyncSkillsSourceRepoServiceInput = {
  db: ControlPlaneDatabase;
  dataPlaneClient: Pick<
    DataPlaneSandboxInstancesClient,
    "getSandboxInstance" | "resumeSandboxInstance" | "startSandboxInstance" | "stopSandboxInstance"
  >;
  gatewayWebsocketUrl: string;
  connectionTokenConfig: ConnectionTokenConfig;
  connectionTokenTtlSeconds: number;
};

export type SyncSkillsSourceRepoInput = {
  organizationId: string;
  originUrl: string;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  runtimePlan: CompiledRuntimePlan;
  sandboxRuntime: {
    provider: SandboxProvider;
    connectionId?: string;
    resources?: {
      vcpuCount: number;
      memoryMb: number;
      storageMb?: number;
    };
  };
  image: {
    imageId: string;
    kind: "base" | "snapshot";
    provider: SandboxProvider;
  };
  idempotencyKey: string;
  startedBy: {
    kind: SandboxInstanceStarterKind;
    id: string;
  };
  source: SandboxInstanceSource;
};

export type SyncSkillsSourceRepoOutput = {
  sandboxInstanceId: string;
  workflowRunId: string;
  skillsSourceRepo: SkillsSourceRepo;
};

export async function syncSkillsSourceRepo(
  serviceInput: SyncSkillsSourceRepoServiceInput,
  input: SyncSkillsSourceRepoInput,
): Promise<SyncSkillsSourceRepoOutput> {
  const discoveryRuntimePlan = buildSkillsSourceRepoDiscoveryRuntimePlan({
    runtimePlan: input.runtimePlan,
    originUrl: input.originUrl,
  });
  const repoRoot = discoveryRuntimePlan.workspaceSources[0]?.path;
  if (repoRoot === undefined) {
    throw new Error("Skills source discovery runtime plan did not include a workspace source.");
  }

  const startedSandbox = await serviceInput.dataPlaneClient.startSandboxInstance({
    organizationId: input.organizationId,
    sandboxProfileId: input.sandboxProfileId,
    sandboxProfileVersion: input.sandboxProfileVersion,
    purpose: SandboxInstancePurposes.SKILLS_DISCOVERY,
    idempotencyKey: input.idempotencyKey,
    runtimePlan: discoveryRuntimePlan,
    startedBy: input.startedBy,
    source: input.source,
    image: {
      imageId: input.image.imageId,
      kind: input.image.kind,
      provider: input.image.provider,
    },
    sandboxRuntime: input.sandboxRuntime,
  });

  try {
    const discoverOutput = await discoverSkillsInSandbox(serviceInput, {
      organizationId: input.organizationId,
      sandboxInstanceId: startedSandbox.sandboxInstanceId,
      repoRoot,
    });
    const skillsSourceRepo = await persistSkillsSourceRepoSyncResult(
      {
        db: serviceInput.db,
      },
      {
        organizationId: input.organizationId,
        originUrl: input.originUrl,
        discoverOutput,
      },
    );

    return {
      sandboxInstanceId: startedSandbox.sandboxInstanceId,
      workflowRunId: startedSandbox.workflowRunId,
      skillsSourceRepo,
    };
  } finally {
    await serviceInput.dataPlaneClient.stopSandboxInstance({
      stopReason: "user",
      organizationId: input.organizationId,
      sandboxInstanceId: startedSandbox.sandboxInstanceId,
      idempotencyKey: `${input.idempotencyKey}:stop`,
    });
  }
}

export function buildSkillsSourceRepoDiscoveryRuntimePlan(input: {
  runtimePlan: CompiledRuntimePlan;
  originUrl: string;
}): CompiledRuntimePlan {
  const workspaceSources = input.runtimePlan.workspaceSources.filter(
    (workspaceSource) => workspaceSource.originUrl === input.originUrl,
  );
  if (workspaceSources.length === 0) {
    throw new Error(`Runtime plan does not include skills source repo '${input.originUrl}'.`);
  }
  if (workspaceSources.length > 1) {
    throw new Error(`Runtime plan includes duplicate skills source repo '${input.originUrl}'.`);
  }

  return {
    sandboxProfileId: input.runtimePlan.sandboxProfileId,
    version: input.runtimePlan.version,
    image: input.runtimePlan.image,
    egressRoutes: input.runtimePlan.egressRoutes,
    artifacts: [],
    workspaceSources,
    runtimeClients: [],
    agentRuntimes: [],
  };
}

export function parseSkillsDiscoverCommandOutput(stdout: string): SkillsDiscoverOutput {
  return SkillsDiscoverOutputSchema.parse(JSON.parse(stdout));
}

export async function persistSkillsSourceRepoSyncResult(
  { db }: { db: ControlPlaneDatabase },
  input: {
    organizationId: string;
    originUrl: string;
    discoverOutput: SkillsDiscoverOutput;
  },
): Promise<SkillsSourceRepo> {
  const tables = getControlPlaneDatabaseSchema(db);
  const skills: SkillsSourceRepoSkill[] = input.discoverOutput.skills.map((skill) => ({
    name: skill.name,
    description: skill.description,
    relativePath: skill.relativePath,
  }));
  const [skillsSourceRepo] = await db
    .insert(tables.skillsSourceRepos)
    .values({
      organizationId: input.organizationId,
      originUrl: input.originUrl,
      commitSha: input.discoverOutput.commitSha,
      skills,
      lastSyncedAt: sql`now()`,
    })
    .onConflictDoUpdate({
      target: [tables.skillsSourceRepos.organizationId, tables.skillsSourceRepos.originUrl],
      set: {
        commitSha: input.discoverOutput.commitSha,
        skills,
        lastSyncedAt: sql`now()`,
        updatedAt: sql`now()`,
      },
    })
    .returning();

  if (skillsSourceRepo === undefined) {
    throw new Error("Skills source repo sync did not return an upserted row.");
  }

  return skillsSourceRepo;
}

async function discoverSkillsInSandbox(
  serviceInput: SyncSkillsSourceRepoServiceInput,
  input: {
    organizationId: string;
    sandboxInstanceId: string;
    repoRoot: string;
  },
): Promise<SkillsDiscoverOutput> {
  const connectionToken = await mintConnectionToken(
    {
      db: serviceInput.db,
      dataPlaneClient: serviceInput.dataPlaneClient,
      gatewayWebsocketUrl: serviceInput.gatewayWebsocketUrl,
      tokenTtlSeconds: serviceInput.connectionTokenTtlSeconds,
      tokenConfig: serviceInput.connectionTokenConfig,
    },
    {
      organizationId: input.organizationId,
      instanceId: input.sandboxInstanceId,
    },
  );
  const transport = new SandboxSessionTransport({
    runtime: createNodeSandboxSessionRuntime(),
  });

  await transport.connect({
    connectionUrl: connectionToken.url,
  });

  try {
    const exec = new ExecStreamClient({
      transport,
      idleTimeoutMs: SkillsDiscoverCommandTimeoutMs,
    });
    const result = await exec.run({
      command: "sandboxd",
      args: ["skills", "discover", "--repo", input.repoRoot],
      timeoutMs: SkillsDiscoverCommandTimeoutMs,
      maxOutputBytes: SkillsDiscoverCommandOutputBytes,
    });
    if (result.exitCode !== 0) {
      throw new Error(
        `sandboxd skills discover failed with exit code ${String(result.exitCode)}: ${result.stderr}`,
      );
    }
    if (result.truncated) {
      throw new Error("sandboxd skills discover output was truncated.");
    }

    return parseSkillsDiscoverCommandOutput(result.stdout);
  } finally {
    transport.disconnect();
  }
}
