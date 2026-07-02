import type { SandboxImageHandle } from "@mistle/sandbox";
import type {
  PruneUnusedSandboxImagesWorkflowInput,
  PruneUnusedSandboxImagesWorkflowOutput,
  PruneUnusedSandboxImagesWorkflowTargetInput,
  PruneUnusedSandboxImagesWorkflowTargetOutput,
} from "@mistle/workflow-registry/data-plane";

import type { WorkflowContext } from "../core/context.js";

export async function pruneUnusedSandboxImages(
  ctx: Pick<WorkflowContext, "logger" | "sandboxRuntimeProviderResolver">,
  input: PruneUnusedSandboxImagesWorkflowInput,
): Promise<PruneUnusedSandboxImagesWorkflowOutput> {
  const cutoffMs = Date.parse(input.cutoff);
  if (!Number.isFinite(cutoffMs)) {
    throw new Error("Unused sandbox image pruning cutoff must be a valid timestamp.");
  }

  const targetResults: PruneUnusedSandboxImagesWorkflowTargetOutput[] = [];
  for (const target of input.targets) {
    try {
      targetResults.push(await pruneTarget(ctx, target, cutoffMs));
    } catch (error) {
      ctx.logger.warn(
        {
          err: error,
          organizationId: target.organizationId,
          provider: target.provider,
          connectionId: target.connectionId,
        },
        "Failed to prune unused sandbox images for provider target.",
      );
      targetResults.push({
        organizationId: target.organizationId,
        provider: target.provider,
        ...(target.connectionId === undefined ? {} : { connectionId: target.connectionId }),
        providerImageCount: 0,
        referencedImageCount: target.referencedImages.length,
        deletionCandidateCount: 0,
        deletedCount: 0,
        failedCount: 1,
      });
    }
  }

  return {
    providerImageCount: sum(targetResults, (target) => target.providerImageCount),
    referencedImageCount: sum(targetResults, (target) => target.referencedImageCount),
    deletionCandidateCount: sum(targetResults, (target) => target.deletionCandidateCount),
    deletedCount: sum(targetResults, (target) => target.deletedCount),
    failedCount: sum(targetResults, (target) => target.failedCount),
    targets: targetResults,
  };
}

export function selectUnusedSandboxImageDeletionCandidates(input: {
  images: readonly SandboxImageHandle[];
  referencedImages: ReadonlySet<string>;
  cutoffMs: number;
}): SandboxImageHandle[] {
  return input.images
    .filter((image) => {
      const createdAtMs = Date.parse(image.createdAt);
      return Number.isFinite(createdAtMs) && createdAtMs < input.cutoffMs;
    })
    .filter((image) => !input.referencedImages.has(createSandboxImageReferenceKey(image)))
    .toSorted(compareSandboxImageCreatedAt);
}

async function pruneTarget(
  ctx: Pick<WorkflowContext, "logger" | "sandboxRuntimeProviderResolver">,
  target: PruneUnusedSandboxImagesWorkflowTargetInput,
  cutoffMs: number,
): Promise<PruneUnusedSandboxImagesWorkflowTargetOutput> {
  const runtime = await ctx.sandboxRuntimeProviderResolver.resolve({
    organizationId: target.organizationId,
    provider: target.provider,
    ...(target.connectionId === undefined ? {} : { connectionId: target.connectionId }),
  });
  const providerImages = await runtime.sandboxAdapter.listImages();
  const referencedImages = new Set(target.referencedImages.map(createSandboxImageReferenceKey));
  const candidates = selectUnusedSandboxImageDeletionCandidates({
    images: providerImages,
    referencedImages,
    cutoffMs,
  });

  let deletedCount = 0;
  let failedCount = 0;
  for (const candidate of candidates) {
    try {
      await runtime.sandboxAdapter.deleteImage({ image: candidate });
      deletedCount += 1;
    } catch (error) {
      failedCount += 1;
      ctx.logger.warn(
        {
          err: error,
          provider: candidate.provider,
          imageId: candidate.imageId,
          organizationId: target.organizationId,
          connectionId: target.connectionId,
        },
        "Failed to delete unreferenced sandbox image.",
      );
    }
  }

  return {
    organizationId: target.organizationId,
    provider: target.provider,
    ...(target.connectionId === undefined ? {} : { connectionId: target.connectionId }),
    providerImageCount: providerImages.length,
    referencedImageCount: referencedImages.size,
    deletionCandidateCount: candidates.length,
    deletedCount,
    failedCount,
  };
}

function createSandboxImageReferenceKey(
  image: Pick<SandboxImageHandle, "provider" | "imageId">,
): string {
  return `${image.provider}\0${image.imageId}`;
}

function compareSandboxImageCreatedAt(left: SandboxImageHandle, right: SandboxImageHandle): number {
  return Date.parse(left.createdAt) - Date.parse(right.createdAt);
}

function sum<T>(values: readonly T[], selector: (value: T) => number): number {
  return values.reduce((total, value) => total + selector(value), 0);
}
