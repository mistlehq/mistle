import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import {
  SandboxProfileVersionSnapshotJobStates,
  type ControlPlaneDatabase,
  type ControlPlaneTables,
} from "@mistle/db/control-plane";
import type { SandboxProvider, SandboxImageHandle } from "@mistle/sandbox";
import type { PruneUnusedSandboxImagesWorkflowOutput } from "@mistle/workflow-registry/control-plane";
import { and, eq, gt, isNotNull, or, sql } from "drizzle-orm";

import { logger } from "../../logger.js";

export const SandboxImagePruneRetentionHours = 24;
const SandboxImagePruneRetentionMs = SandboxImagePruneRetentionHours * 60 * 60 * 1000;

type SandboxImageReference = Pick<SandboxImageHandle, "provider" | "imageId">;

type SandboxImagePruneTarget = {
  organizationId: string;
  provider: SandboxProvider;
  connectionId?: string;
  referencedImages: SandboxImageReference[];
};

type PruneUnusedSandboxImagesPlan = {
  cutoff: string;
  targets: SandboxImagePruneTarget[];
  referencedImageCount: number;
};

export async function pruneUnusedSandboxImages(ctx: {
  db: ControlPlaneDatabase;
  tables: ControlPlaneTables;
  dataPlaneClient: Pick<DataPlaneSandboxInstancesClient, "pruneUnusedSandboxImages">;
  now: Date;
}): Promise<PruneUnusedSandboxImagesWorkflowOutput> {
  const plan = await createPruneUnusedSandboxImagesPlan({
    db: ctx.db,
    tables: ctx.tables,
    now: ctx.now,
  });

  if (plan.targets.length === 0) {
    throw new Error("Unused sandbox image pruning requires at least one sandbox image target.");
  }

  const response = await ctx.dataPlaneClient.pruneUnusedSandboxImages({
    cutoff: plan.cutoff,
    targets: plan.targets,
    idempotencyKey: `sandbox-images-prune-unused:${plan.cutoff}`,
  });

  const output = {
    retentionHours: SandboxImagePruneRetentionHours,
    referencedImageCount: plan.referencedImageCount,
    targetCount: plan.targets.length,
    dataPlaneWorkflowRunId: response.workflowRunId,
  };

  logger.info(
    {
      eventName: "sandbox_images.prune_unused.enqueued",
      ...output,
    },
    "Enqueued unused sandbox image pruning in data-plane.",
  );

  return output;
}

export async function createPruneUnusedSandboxImagesPlan(ctx: {
  db: ControlPlaneDatabase;
  tables: Pick<
    ControlPlaneTables,
    "sandboxProfiles" | "sandboxProfileVersions" | "sandboxProfileVersionSnapshotJobs"
  >;
  now: Date;
}): Promise<PruneUnusedSandboxImagesPlan> {
  const cutoff = new Date(ctx.now.getTime() - SandboxImagePruneRetentionMs).toISOString();
  const targets = new Map<string, SandboxImagePruneTarget>();
  const referencedImages = new Set<string>();

  const profileVersions = await ctx.db
    .select({
      organizationId: ctx.tables.sandboxProfiles.organizationId,
      sandboxProvider: sql<SandboxProvider>`${ctx.tables.sandboxProfileVersions.sandboxProvider}`,
      sandboxConnectionId: ctx.tables.sandboxProfileVersions.sandboxConnectionId,
      snapshotImageProvider: sql<SandboxProvider | null>`${ctx.tables.sandboxProfileVersions.snapshotImageProvider}`,
      snapshotImageId: ctx.tables.sandboxProfileVersions.snapshotImageId,
    })
    .from(ctx.tables.sandboxProfileVersions)
    .innerJoin(
      ctx.tables.sandboxProfiles,
      eq(ctx.tables.sandboxProfiles.id, ctx.tables.sandboxProfileVersions.sandboxProfileId),
    )
    .where(isNotNull(ctx.tables.sandboxProfileVersions.sandboxProvider));

  for (const profileVersion of profileVersions) {
    addPruneTarget(targets, {
      organizationId: profileVersion.organizationId,
      provider: profileVersion.sandboxProvider,
      connectionId: profileVersion.sandboxConnectionId,
    });
    addReferencedImageTarget(targets, referencedImages, {
      organizationId: profileVersion.organizationId,
      runtimeProvider: profileVersion.sandboxProvider,
      runtimeConnectionId: profileVersion.sandboxConnectionId,
      imageProvider: profileVersion.snapshotImageProvider,
      imageId: profileVersion.snapshotImageId,
    });
  }

  const activeOrRecentSnapshotJobs = await ctx.db
    .select({
      organizationId: ctx.tables.sandboxProfiles.organizationId,
      sandboxProvider: sql<SandboxProvider>`${ctx.tables.sandboxProfileVersions.sandboxProvider}`,
      sandboxConnectionId: ctx.tables.sandboxProfileVersions.sandboxConnectionId,
      candidateImageProvider: sql<SandboxProvider | null>`${ctx.tables.sandboxProfileVersionSnapshotJobs.candidateImageProvider}`,
      candidateImageId: ctx.tables.sandboxProfileVersionSnapshotJobs.candidateImageId,
    })
    .from(ctx.tables.sandboxProfileVersionSnapshotJobs)
    .innerJoin(
      ctx.tables.sandboxProfileVersions,
      and(
        eq(
          ctx.tables.sandboxProfileVersions.sandboxProfileId,
          ctx.tables.sandboxProfileVersionSnapshotJobs.sandboxProfileId,
        ),
        eq(
          ctx.tables.sandboxProfileVersions.version,
          ctx.tables.sandboxProfileVersionSnapshotJobs.sandboxProfileVersion,
        ),
      ),
    )
    .innerJoin(
      ctx.tables.sandboxProfiles,
      eq(ctx.tables.sandboxProfiles.id, ctx.tables.sandboxProfileVersions.sandboxProfileId),
    )
    .where(
      and(
        isNotNull(ctx.tables.sandboxProfileVersions.sandboxProvider),
        or(
          eq(
            ctx.tables.sandboxProfileVersionSnapshotJobs.state,
            SandboxProfileVersionSnapshotJobStates.QUEUED,
          ),
          eq(
            ctx.tables.sandboxProfileVersionSnapshotJobs.state,
            SandboxProfileVersionSnapshotJobStates.RUNNING,
          ),
          and(
            eq(
              ctx.tables.sandboxProfileVersionSnapshotJobs.state,
              SandboxProfileVersionSnapshotJobStates.SUCCEEDED,
            ),
            gt(ctx.tables.sandboxProfileVersionSnapshotJobs.finishedAt, cutoff),
          ),
        ),
      ),
    );

  for (const snapshotJob of activeOrRecentSnapshotJobs) {
    addReferencedImageTarget(targets, referencedImages, {
      organizationId: snapshotJob.organizationId,
      runtimeProvider: snapshotJob.sandboxProvider,
      runtimeConnectionId: snapshotJob.sandboxConnectionId,
      imageProvider: snapshotJob.candidateImageProvider,
      imageId: snapshotJob.candidateImageId,
    });
  }

  return {
    cutoff,
    targets: [...targets.values()],
    referencedImageCount: referencedImages.size,
  };
}

function addReferencedImageTarget(
  targets: Map<string, SandboxImagePruneTarget>,
  referencedImages: Set<string>,
  input: {
    organizationId: string;
    runtimeProvider: SandboxProvider;
    runtimeConnectionId: string | null;
    imageProvider: SandboxProvider | null;
    imageId: string | null;
  },
): void {
  if (input.imageProvider === null || input.imageId === null) {
    return;
  }

  const reference = {
    provider: input.imageProvider,
    imageId: input.imageId,
  };
  referencedImages.add(createSandboxImageReferenceKey(reference));

  const connectionId =
    input.runtimeProvider === input.imageProvider ? input.runtimeConnectionId : null;
  const target = addPruneTarget(targets, {
    organizationId: input.organizationId,
    provider: input.imageProvider,
    connectionId,
  });

  target.referencedImages.push(reference);
}

function addPruneTarget(
  targets: Map<string, SandboxImagePruneTarget>,
  input: {
    organizationId: string;
    provider: SandboxProvider;
    connectionId: string | null;
  },
): SandboxImagePruneTarget {
  const targetKey = createPruneTargetKey({
    organizationId: input.organizationId,
    provider: input.provider,
    connectionId: input.connectionId,
  });
  const existingTarget = targets.get(targetKey);
  if (existingTarget !== undefined) {
    return existingTarget;
  }

  const target = {
    organizationId: input.organizationId,
    provider: input.provider,
    ...(input.connectionId === null ? {} : { connectionId: input.connectionId }),
    referencedImages: [],
  };
  targets.set(targetKey, target);
  return target;
}

function createPruneTargetKey(input: {
  organizationId: string;
  provider: SandboxProvider;
  connectionId: string | null;
}): string {
  if (input.connectionId === null) {
    return `managed\0${input.provider}`;
  }

  return `${input.organizationId}\0${input.provider}\0${input.connectionId}`;
}

function createSandboxImageReferenceKey(image: SandboxImageReference): string {
  return `${image.provider}\0${image.imageId}`;
}
