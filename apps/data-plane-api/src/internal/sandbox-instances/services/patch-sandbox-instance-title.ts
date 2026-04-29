import {
  sandboxInstances,
  SandboxInstancePurposes,
  type DataPlaneDatabase,
} from "@mistle/db/data-plane";
import { NotFoundError } from "@mistle/http/errors.js";
import { and, eq, isNull } from "drizzle-orm";
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
  const titlePredicate = input.onlyIfUnset === true ? isNull(sandboxInstances.title) : undefined;
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
        eq(sandboxInstances.purpose, SandboxInstancePurposes.SESSION),
        ...(titlePredicate === undefined ? [] : [titlePredicate]),
      ),
    )
    .returning({
      id: sandboxInstances.id,
      title: sandboxInstances.title,
      updatedAt: sandboxInstances.updatedAt,
    });

  if (sandboxInstance !== undefined && sandboxInstance.title !== null) {
    return {
      id: sandboxInstance.id,
      title: sandboxInstance.title,
      updatedAt: sandboxInstance.updatedAt,
    };
  }

  if (input.onlyIfUnset !== true) {
    throw new NotFoundError(
      SandboxInstanceNotFoundErrorCode,
      `Sandbox instance '${input.instanceId}' was not found.`,
    );
  }

  const existingSandboxInstance = await ctx.db.query.sandboxInstances.findFirst({
    columns: {
      id: true,
      title: true,
      updatedAt: true,
    },
    where: (table, { eq: whereEq, and: whereAnd }) =>
      whereAnd(
        whereEq(table.id, input.instanceId),
        whereEq(table.organizationId, input.organizationId),
        whereEq(table.purpose, SandboxInstancePurposes.SESSION),
      ),
  });

  if (existingSandboxInstance === undefined || existingSandboxInstance.title === null) {
    throw new NotFoundError(
      SandboxInstanceNotFoundErrorCode,
      `Sandbox instance '${input.instanceId}' was not found.`,
    );
  }

  return {
    id: existingSandboxInstance.id,
    title: existingSandboxInstance.title,
    updatedAt: existingSandboxInstance.updatedAt,
  };
}
