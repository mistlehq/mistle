import type {
  IntegrationBindingKind,
  SandboxProfileVersionIntegrationBinding,
} from "@mistle/db/control-plane";
import { sandboxProfileVersionIntegrationBindings } from "@mistle/db/control-plane";
import { IntegrationKinds, runDefinitionBindingWriteValidation } from "@mistle/integrations-core";
import { createIntegrationRegistry } from "@mistle/integrations-definitions";
import { and, eq, inArray, sql } from "drizzle-orm";

import {
  SandboxProfilesIntegrationBindingsBadRequestCodes,
  SandboxProfilesIntegrationBindingsBadRequestError,
  SandboxProfilesNotFoundCodes,
  SandboxProfilesNotFoundError,
} from "./errors.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";
import { validateBindingResources } from "./validate-binding-resources.js";

type PutProfileVersionIntegrationBindingsInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
  bindings: Array<{
    id?: string;
    clientRef?: string;
    connectionId: string;
    kind: IntegrationBindingKind;
    config: Record<string, unknown>;
  }>;
};

type PutProfileVersionIntegrationBindingsResult = {
  bindings: SandboxProfileVersionIntegrationBinding[];
};

const IntegrationRegistry = createIntegrationRegistry();

type BindingConfigObject = {
  [key: string]: unknown;
};

function parseBindingConfigObject(value: unknown): BindingConfigObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected parsed binding config to be an object.");
  }

  const record: BindingConfigObject = {};

  for (const [key, entryValue] of Object.entries(value)) {
    record[key] = entryValue;
  }

  return record;
}

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

function findGitFamilyConflictIssues(
  bindings: ReadonlyArray<{
    clientRef?: string;
    bindingIdOrDraftIndex: string;
    definition: {
      kind: string;
      familyId: string;
    };
  }>,
): ReadonlyArray<{
  clientRef?: string;
  bindingIdOrDraftIndex: string;
  validatorCode: string;
  field: string;
  safeMessage: string;
}> {
  const seenGitFamilies = new Set<string>();
  const issues: Array<{
    clientRef?: string;
    bindingIdOrDraftIndex: string;
    validatorCode: string;
    field: string;
    safeMessage: string;
  }> = [];

  for (const binding of bindings) {
    if (binding.definition.kind !== IntegrationKinds.GIT) {
      continue;
    }

    if (!seenGitFamilies.has(binding.definition.familyId)) {
      seenGitFamilies.add(binding.definition.familyId);
      continue;
    }

    issues.push({
      ...(binding.clientRef === undefined ? {} : { clientRef: binding.clientRef }),
      bindingIdOrDraftIndex: binding.bindingIdOrDraftIndex,
      validatorCode: "system.duplicate_git_family_binding",
      field: "connectionId",
      safeMessage: `Only one binding from Git integration family '${binding.definition.familyId}' may exist on a sandbox profile version.`,
    });
  }

  return issues;
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
  const availableConnectionsById = new Map<
    string,
    {
      id: string;
      targetKey: string;
      config: Record<string, unknown>;
    }
  >();
  if (requestedConnectionIds.length > 0) {
    const availableConnections = await db.query.integrationConnections.findMany({
      columns: {
        id: true,
        targetKey: true,
        config: true,
      },
      where: (table, { and, eq, inArray }) =>
        and(
          eq(table.organizationId, input.organizationId),
          inArray(table.id, requestedConnectionIds),
        ),
    });
    for (const connection of availableConnections) {
      availableConnectionsById.set(connection.id, {
        id: connection.id,
        targetKey: connection.targetKey,
        config: connection.config ?? {},
      });
    }
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

  const requestedTargetKeys = [
    ...new Set([...availableConnectionsById.values()].map((value) => value.targetKey)),
  ];
  const targetsByKey = new Map<
    string,
    {
      familyId: string;
      variantId: string;
      config: Record<string, unknown>;
    }
  >();
  if (requestedTargetKeys.length > 0) {
    const targets = await db.query.integrationTargets.findMany({
      columns: {
        targetKey: true,
        familyId: true,
        variantId: true,
        config: true,
      },
      where: (table, { inArray }) => inArray(table.targetKey, requestedTargetKeys),
    });
    for (const target of targets) {
      targetsByKey.set(target.targetKey, {
        familyId: target.familyId,
        variantId: target.variantId,
        config: target.config,
      });
    }
  }

  const validatedBindings: Array<{
    clientRef?: string;
    bindingIdOrDraftIndex: string;
    bindingConfig: Record<string, unknown>;
    connectionId: string;
    definition: ReturnType<typeof IntegrationRegistry.getDefinitionOrThrow>;
  }> = [];

  for (const [bindingIndex, binding] of input.bindings.entries()) {
    const resolvedConnection = availableConnectionsById.get(binding.connectionId);
    if (resolvedConnection === undefined) {
      throw new SandboxProfilesIntegrationBindingsBadRequestError(
        SandboxProfilesIntegrationBindingsBadRequestCodes.INVALID_BINDING_CONNECTION_REFERENCE,
        `Binding references connection '${binding.connectionId}' that is missing or inaccessible.`,
      );
    }
    const resolvedTarget = targetsByKey.get(resolvedConnection.targetKey);
    if (resolvedTarget === undefined) {
      throw new SandboxProfilesIntegrationBindingsBadRequestError(
        SandboxProfilesIntegrationBindingsBadRequestCodes.INVALID_BINDING_CONFIG_REFERENCE,
        `Binding '${binding.id ?? `draft:${String(bindingIndex)}`}' has invalid config reference: Target '${resolvedConnection.targetKey}' could not be resolved.`,
        {
          issues: [
            {
              ...(binding.clientRef === undefined ? {} : { clientRef: binding.clientRef }),
              bindingIdOrDraftIndex: binding.id ?? `draft:${String(bindingIndex)}`,
              validatorCode: "system.invalid_target_reference",
              field: "targetKey",
              safeMessage: `Target '${resolvedConnection.targetKey}' could not be resolved for binding validation.`,
            },
          ],
        },
      );
    }
    const definition = IntegrationRegistry.getDefinitionOrThrow({
      familyId: resolvedTarget.familyId,
      variantId: resolvedTarget.variantId,
    });
    const validationResult = runDefinitionBindingWriteValidation({
      definition,
      targetKey: resolvedConnection.targetKey,
      target: {
        familyId: resolvedTarget.familyId,
        variantId: resolvedTarget.variantId,
        config: resolvedTarget.config,
      },
      connection: {
        id: resolvedConnection.id,
        config: resolvedConnection.config,
      },
      binding: {
        kind: binding.kind,
        config: binding.config,
      },
      bindingIdOrDraftIndex: binding.id ?? `draft:${String(bindingIndex)}`,
    });
    if (!validationResult.ok) {
      const firstIssue = validationResult.issues[0];
      throw new SandboxProfilesIntegrationBindingsBadRequestError(
        SandboxProfilesIntegrationBindingsBadRequestCodes.INVALID_BINDING_CONFIG_REFERENCE,
        `Binding '${binding.id ?? `draft:${String(bindingIndex)}`}' has invalid config reference: ${firstIssue?.safeMessage ?? "Binding config is invalid."}`,
        {
          issues: validationResult.issues.map((issue) => ({
            ...(binding.clientRef === undefined ? {} : { clientRef: binding.clientRef }),
            bindingIdOrDraftIndex: binding.id ?? `draft:${String(bindingIndex)}`,
            validatorCode: issue.code,
            field: issue.field,
            safeMessage: issue.safeMessage,
          })),
        },
      );
    }

    validatedBindings.push({
      ...(binding.clientRef === undefined ? {} : { clientRef: binding.clientRef }),
      bindingIdOrDraftIndex: binding.id ?? `draft:${String(bindingIndex)}`,
      bindingConfig: parseBindingConfigObject(validationResult.parsed.bindingConfig),
      connectionId: binding.connectionId,
      definition,
    });
  }

  const gitFamilyConflictIssues = findGitFamilyConflictIssues(validatedBindings);
  if (gitFamilyConflictIssues.length > 0) {
    const firstIssue = gitFamilyConflictIssues[0];
    throw new SandboxProfilesIntegrationBindingsBadRequestError(
      SandboxProfilesIntegrationBindingsBadRequestCodes.INVALID_BINDING_CONFIG_REFERENCE,
      `Binding '${firstIssue?.bindingIdOrDraftIndex ?? "unknown"}' has invalid config reference: ${firstIssue?.safeMessage ?? "Binding config is invalid."}`,
      {
        issues: gitFamilyConflictIssues,
      },
    );
  }

  const bindingResourceValidationResult = await validateBindingResources({
    db,
    bindings: validatedBindings,
  });
  if (!bindingResourceValidationResult.ok) {
    const firstIssue = bindingResourceValidationResult.issues[0];
    throw new SandboxProfilesIntegrationBindingsBadRequestError(
      SandboxProfilesIntegrationBindingsBadRequestCodes.INVALID_BINDING_CONFIG_REFERENCE,
      `Binding '${firstIssue?.bindingIdOrDraftIndex ?? "unknown"}' has invalid config reference: ${firstIssue?.safeMessage ?? "Binding config is invalid."}`,
      {
        issues: bindingResourceValidationResult.issues.map((issue) => ({
          ...(issue.clientRef === undefined ? {} : { clientRef: issue.clientRef }),
          bindingIdOrDraftIndex: issue.bindingIdOrDraftIndex,
          validatorCode: issue.validatorCode,
          field: issue.field,
          safeMessage: issue.safeMessage,
        })),
      },
    );
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
