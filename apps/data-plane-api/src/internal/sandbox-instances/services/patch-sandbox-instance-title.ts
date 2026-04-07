import { sandboxInstances, type DataPlaneDatabase } from "@mistle/db/data-plane";
import { NotFoundError } from "@mistle/http/errors.js";
import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

import type {
  PatchSandboxInstanceTitleInput,
  PatchSandboxInstanceTitleResponse,
} from "../patch-sandbox-instance-title/schema.js";

const SandboxInstanceNotFoundErrorCode = "NOT_FOUND";

type PatchSandboxInstanceTitleContext = {
  db: DataPlaneDatabase;
};

export async function patchSandboxInstanceTitle(
  ctx: PatchSandboxInstanceTitleContext,
  input: PatchSandboxInstanceTitleInput,
): Promise<PatchSandboxInstanceTitleResponse> {
  const [sandboxInstance] = await ctx.db
    .update(sandboxInstances)
    .set({
      title: input.title,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(sandboxInstances.id, input.instanceId),
        eq(sandboxInstances.organizationId, input.organizationId),
      ),
    )
    .returning({
      id: sandboxInstances.id,
      title: sandboxInstances.title,
    });

  if (sandboxInstance === undefined || sandboxInstance.title === null) {
    throw new NotFoundError(
      SandboxInstanceNotFoundErrorCode,
      `Sandbox instance '${input.instanceId}' was not found.`,
    );
  }

  return {
    id: sandboxInstance.id,
    title: sandboxInstance.title,
  };
}
