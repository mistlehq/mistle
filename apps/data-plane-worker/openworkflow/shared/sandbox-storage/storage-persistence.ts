import {
  sandboxInstanceStorages,
  type DataPlaneDatabase,
  type InsertSandboxInstanceStorage,
  type SandboxInstanceStorage,
} from "@mistle/db/data-plane";
import { eq, sql } from "drizzle-orm";

export type CompensationAction = {
  run: () => Promise<void>;
};

export async function getSandboxInstanceStorageBySandboxInstanceId(
  ctx: {
    db: DataPlaneDatabase;
  },
  input: {
    sandboxInstanceId: string;
  },
): Promise<SandboxInstanceStorage | undefined> {
  return ctx.db.query.sandboxInstanceStorages.findFirst({
    where: (table, { eq }) => eq(table.sandboxInstanceId, input.sandboxInstanceId),
  });
}

export async function insertSandboxInstanceStorage(
  ctx: {
    db: DataPlaneDatabase;
  },
  input: InsertSandboxInstanceStorage,
): Promise<SandboxInstanceStorage> {
  const insertedRows = await ctx.db
    .insert(sandboxInstanceStorages)
    .values(input)
    .onConflictDoNothing({
      target: [sandboxInstanceStorages.sandboxInstanceId],
    })
    .returning();

  const insertedRow = insertedRows[0];
  if (insertedRow === undefined) {
    throw new Error(
      `Sandbox storage row for sandbox instance '${input.sandboxInstanceId}' already exists.`,
    );
  }

  return insertedRow;
}

export async function updateSandboxInstanceStorageCredential(
  ctx: {
    db: DataPlaneDatabase;
  },
  input: {
    sandboxInstanceId: string;
    status: SandboxInstanceStorage["status"];
    credentialCiphertext: string;
    credentialNonce: string;
    organizationCredentialKeyVersion: number;
    credentialKind: SandboxInstanceStorage["credentialKind"];
  },
): Promise<void> {
  const updatedRows = await ctx.db
    .update(sandboxInstanceStorages)
    .set({
      status: input.status,
      credentialCiphertext: input.credentialCiphertext,
      credentialNonce: input.credentialNonce,
      organizationCredentialKeyVersion: input.organizationCredentialKeyVersion,
      credentialKind: input.credentialKind,
      updatedAt: sql`now()`,
    })
    .where(eq(sandboxInstanceStorages.sandboxInstanceId, input.sandboxInstanceId))
    .returning({
      id: sandboxInstanceStorages.id,
    });

  if (updatedRows[0] === undefined) {
    throw new Error(
      `Sandbox storage row for sandbox instance '${input.sandboxInstanceId}' was not found.`,
    );
  }
}

export async function deleteSandboxInstanceStorageBySandboxInstanceId(
  ctx: {
    db: DataPlaneDatabase;
  },
  input: {
    sandboxInstanceId: string;
  },
): Promise<void> {
  const deletedRows = await ctx.db
    .delete(sandboxInstanceStorages)
    .where(eq(sandboxInstanceStorages.sandboxInstanceId, input.sandboxInstanceId))
    .returning({
      id: sandboxInstanceStorages.id,
    });

  if (deletedRows[0] === undefined) {
    throw new Error(
      `Sandbox storage row for sandbox instance '${input.sandboxInstanceId}' was not found.`,
    );
  }
}

export async function tryDeleteSandboxInstanceStorageById(input: {
  db: DataPlaneDatabase;
  sandboxInstanceStorageId: string;
}): Promise<void> {
  try {
    await input.db
      .delete(sandboxInstanceStorages)
      .where(eq(sandboxInstanceStorages.id, input.sandboxInstanceStorageId));
  } catch {}
}

export function registerCompensationAction(input: {
  compensationActions: CompensationAction[];
  action: CompensationAction;
}): void {
  input.compensationActions.push(input.action);
}

export async function runCompensationActions(input: {
  compensationActions: readonly CompensationAction[];
}): Promise<void> {
  for (const action of [...input.compensationActions].reverse()) {
    await action.run();
  }
}
