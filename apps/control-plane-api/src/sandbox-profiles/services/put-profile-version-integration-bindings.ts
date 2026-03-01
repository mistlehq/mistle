import type {
  IntegrationBindingKind,
  SandboxProfileVersionIntegrationBinding,
} from "@mistle/db/control-plane";
import { sandboxProfileVersionIntegrationBindings } from "@mistle/db/control-plane";
import { and, eq, inArray, sql } from "drizzle-orm";

import {
  SandboxProfilesIntegrationBindingsBadRequestCodes,
  SandboxProfilesIntegrationBindingsBadRequestError,
  SandboxProfilesNotFoundCodes,
  SandboxProfilesNotFoundError,
} from "./errors.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

type PutProfileVersionIntegrationBindingsInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
  bindings: Array<{
    id?: string;
    connectionId: string;
    kind: IntegrationBindingKind;
    config: Record<string, unknown>;
  }>;
};

type PutProfileVersionIntegrationBindingsResult = {
  bindings: SandboxProfileVersionIntegrationBinding[];
};

function findDuplicateBindingId(
  bindings: PutProfileVersionIntegrationBindingsInput["bindings"],
): string | undefined {
  const seenBindingIds = new Set<string>();

  for (const binding of bindings) {
    if (binding.id === undefined) {
      continue;
    }

    if (seenBindingIds.has(binding.id)) {
      return binding.id;
    }

    seenBindingIds.add(binding.id);
  }

  return undefined;
}

export async function putProfileVersionIntegrationBindings(
  { db }: Pick<CreateSandboxProfilesServiceInput, "db">,
  input: PutProfileVersionIntegrationBindingsInput,
): Promise<PutProfileVersionIntegrationBindingsResult> {
  const duplicateBindingId = findDuplicateBindingId(input.bindings);
  if (duplicateBindingId !== undefined) {
    throw new SandboxProfilesIntegrationBindingsBadRequestError(
      SandboxProfilesIntegrationBindingsBadRequestCodes.INVALID_BINDING_REFERENCE,
      `Binding '${duplicateBindingId}' is duplicated in the request body.`,
    );
  }

  const sandboxProfile = await db.query.sandboxProfiles.findFirst({
    columns: {
      id: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.id, input.profileId), eq(table.organizationId, input.organizationId)),
  });

  if (sandboxProfile === undefined) {
    throw new SandboxProfilesNotFoundError(
      SandboxProfilesNotFoundCodes.PROFILE_NOT_FOUND,
      "Sandbox profile was not found.",
    );
  }

  const sandboxProfileVersion = await db.query.sandboxProfileVersions.findFirst({
    columns: {
      sandboxProfileId: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.sandboxProfileId, input.profileId), eq(table.version, input.profileVersion)),
  });

  if (sandboxProfileVersion === undefined) {
    throw new SandboxProfilesNotFoundError(
      SandboxProfilesNotFoundCodes.PROFILE_VERSION_NOT_FOUND,
      "Sandbox profile version was not found.",
    );
  }

  const requestedConnectionIds = [
    ...new Set(input.bindings.map((binding) => binding.connectionId)),
  ];
  if (requestedConnectionIds.length > 0) {
    const availableConnections = await db.query.integrationConnections.findMany({
      columns: {
        id: true,
      },
      where: (table, { and, eq, inArray }) =>
        and(
          eq(table.organizationId, input.organizationId),
          inArray(table.id, requestedConnectionIds),
        ),
    });
    const availableConnectionIdSet = new Set(
      availableConnections.map((connection) => connection.id),
    );

    const invalidConnectionId = requestedConnectionIds.find(
      (connectionId) => !availableConnectionIdSet.has(connectionId),
    );

    if (invalidConnectionId !== undefined) {
      throw new SandboxProfilesIntegrationBindingsBadRequestError(
        SandboxProfilesIntegrationBindingsBadRequestCodes.INVALID_BINDING_CONNECTION_REFERENCE,
        `Binding references connection '${invalidConnectionId}' that is missing or inaccessible.`,
      );
    }
  }

  return db.transaction(async (tx) => {
    const existingBindings = await tx.query.sandboxProfileVersionIntegrationBindings.findMany({
      where: (table, { and, eq }) =>
        and(
          eq(table.sandboxProfileId, input.profileId),
          eq(table.sandboxProfileVersion, input.profileVersion),
        ),
      orderBy: (table, { asc }) => [asc(table.id)],
    });
    const existingBindingsById = new Map(existingBindings.map((binding) => [binding.id, binding]));
    const requestedBindingIds = new Set(
      input.bindings.flatMap((binding) => (binding.id === undefined ? [] : [binding.id])),
    );

    for (const binding of input.bindings) {
      if (binding.id === undefined) {
        continue;
      }

      if (!existingBindingsById.has(binding.id)) {
        throw new SandboxProfilesIntegrationBindingsBadRequestError(
          SandboxProfilesIntegrationBindingsBadRequestCodes.INVALID_BINDING_REFERENCE,
          `Binding '${binding.id}' does not exist on sandbox profile version '${input.profileVersion}'.`,
        );
      }
    }

    const bindingIdsToDelete = existingBindings
      .filter((binding) => !requestedBindingIds.has(binding.id))
      .map((binding) => binding.id);

    if (bindingIdsToDelete.length > 0) {
      await tx
        .delete(sandboxProfileVersionIntegrationBindings)
        .where(
          and(
            eq(sandboxProfileVersionIntegrationBindings.sandboxProfileId, input.profileId),
            eq(
              sandboxProfileVersionIntegrationBindings.sandboxProfileVersion,
              input.profileVersion,
            ),
            inArray(sandboxProfileVersionIntegrationBindings.id, bindingIdsToDelete),
          ),
        );
    }

    const bindingsToInsert = input.bindings.filter((binding) => binding.id === undefined);
    if (bindingsToInsert.length > 0) {
      await tx.insert(sandboxProfileVersionIntegrationBindings).values(
        bindingsToInsert.map((binding) => ({
          sandboxProfileId: input.profileId,
          sandboxProfileVersion: input.profileVersion,
          connectionId: binding.connectionId,
          kind: binding.kind,
          config: binding.config,
        })),
      );
    }

    for (const binding of input.bindings) {
      if (binding.id === undefined) {
        continue;
      }

      await tx
        .update(sandboxProfileVersionIntegrationBindings)
        .set({
          connectionId: binding.connectionId,
          kind: binding.kind,
          config: binding.config,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(sandboxProfileVersionIntegrationBindings.sandboxProfileId, input.profileId),
            eq(
              sandboxProfileVersionIntegrationBindings.sandboxProfileVersion,
              input.profileVersion,
            ),
            eq(sandboxProfileVersionIntegrationBindings.id, binding.id),
          ),
        );
    }

    const persistedBindings = await tx.query.sandboxProfileVersionIntegrationBindings.findMany({
      where: (table, { and, eq }) =>
        and(
          eq(table.sandboxProfileId, input.profileId),
          eq(table.sandboxProfileVersion, input.profileVersion),
        ),
      orderBy: (table, { asc }) => [asc(table.id)],
    });

    return {
      bindings: persistedBindings,
    };
  });
}

export type {
  PutProfileVersionIntegrationBindingsInput,
  PutProfileVersionIntegrationBindingsResult,
};
