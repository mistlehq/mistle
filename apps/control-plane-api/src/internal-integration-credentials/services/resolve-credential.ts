import {
  IntegrationConnectionStatuses,
  IntegrationCredentialSecretKinds,
  type IntegrationBindingKind,
  type IntegrationTarget,
  type IntegrationCredentialSecretKind,
  sandboxProfileVersionIntegrationBindings,
} from "@mistle/db/control-plane";
import { eq } from "drizzle-orm";
import { z } from "zod";

import {
  decryptCredentialUtf8,
  resolveMasterEncryptionKeyMaterial,
  unwrapOrganizationCredentialKey,
} from "../../integration-credentials/crypto.js";
import { resolveIntegrationTargetSecrets } from "../../integration-targets/services/resolve-target-secrets.js";
import type { AppContext } from "../../types.js";
import {
  InternalIntegrationCredentialsError,
  InternalIntegrationCredentialsErrorCodes,
} from "./errors.js";

export type ResolveIntegrationCredentialInput = {
  connectionId: string;
  bindingId?: string;
  secretType: string;
  purpose?: string | undefined;
  resolverKey?: string | undefined;
};

export type ResolvedIntegrationCredential = {
  value: string;
  expiresAt?: string;
};

type ResolvePersistedCredentialInput = {
  db: AppContext["var"]["db"];
  integrationsConfig: AppContext["var"]["config"]["integrations"];
  organizationId: string;
  connectionId: string;
  secretType: string;
  purpose?: string | undefined;
};

type ResolverContextConnection = {
  id: string;
  status: "active" | "error" | "revoked";
  externalSubjectId?: string;
  config: Record<string, unknown>;
};

type ResolverContextTarget = {
  familyId: string;
  variantId: string;
  enabled: boolean;
  config: Record<string, unknown>;
  secrets: Record<string, string>;
};

type ResolverContextBinding = {
  id: string;
  kind: IntegrationBindingKind;
  config: Record<string, unknown>;
};

const UnknownRecordSchema = z.record(z.string(), z.unknown());
const StringRecordSchema = z.record(z.string(), z.string());

function resolveConnectionConfigOrThrow(input: {
  connectionId: string;
  config: unknown;
}): Record<string, unknown> {
  const parsedConfig = UnknownRecordSchema.safeParse(input.config);
  if (!parsedConfig.success) {
    throw new Error(`Integration connection '${input.connectionId}' has invalid config.`);
  }

  return parsedConfig.data;
}

function resolveResolverContextConnection(input: {
  id: string;
  status: "active" | "error" | "revoked";
  externalSubjectId: string | null;
  config: unknown;
}): ResolverContextConnection {
  const config = resolveConnectionConfigOrThrow({
    connectionId: input.id,
    config: input.config,
  });

  return {
    id: input.id,
    status: input.status,
    config,
    ...(input.externalSubjectId === null ? {} : { externalSubjectId: input.externalSubjectId }),
  };
}

function resolveResolverContextTarget(input: {
  target: Pick<
    IntegrationTarget,
    "targetKey" | "familyId" | "variantId" | "enabled" | "config" | "secrets"
  >;
  definition: {
    targetConfigSchema: {
      parse: (input: unknown) => unknown;
    };
    targetSecretSchema: {
      parse: (input: unknown) => unknown;
    };
  };
  integrationsConfig: AppContext["var"]["config"]["integrations"];
}): ResolverContextTarget {
  const parsedTargetConfigOutput = input.definition.targetConfigSchema.parse(input.target.config);
  const parsedTargetConfig = UnknownRecordSchema.safeParse(parsedTargetConfigOutput);
  if (!parsedTargetConfig.success) {
    throw new Error(
      `Integration target '${input.target.targetKey}' has invalid parsed target config.`,
    );
  }

  const decryptedTargetSecrets = resolveIntegrationTargetSecrets({
    integrationsConfig: input.integrationsConfig,
    target: {
      targetKey: input.target.targetKey,
      secrets: input.target.secrets,
    },
  });
  const parsedTargetSecretsOutput =
    input.definition.targetSecretSchema.parse(decryptedTargetSecrets);
  const parsedTargetSecrets = StringRecordSchema.safeParse(parsedTargetSecretsOutput);
  if (!parsedTargetSecrets.success) {
    throw new Error(
      `Integration target '${input.target.targetKey}' has invalid parsed target secrets.`,
    );
  }

  return {
    familyId: input.target.familyId,
    variantId: input.target.variantId,
    enabled: input.target.enabled,
    config: parsedTargetConfig.data,
    secrets: parsedTargetSecrets.data,
  };
}

function resolveResolverContextBinding(input: {
  binding: {
    id: string;
    kind: IntegrationBindingKind;
    config: unknown;
  };
  definition: {
    bindingConfigSchema: {
      parse: (input: unknown) => unknown;
    };
  };
}): ResolverContextBinding {
  const parsedBindingConfigOutput = input.definition.bindingConfigSchema.parse(
    input.binding.config,
  );
  const parsedBindingConfig = UnknownRecordSchema.safeParse(parsedBindingConfigOutput);
  if (!parsedBindingConfig.success) {
    throw new InternalIntegrationCredentialsError(
      InternalIntegrationCredentialsErrorCodes.INVALID_BINDING_CONFIG,
      400,
      `Integration binding '${input.binding.id}' has invalid parsed binding config.`,
    );
  }

  return {
    id: input.binding.id,
    kind: input.binding.kind,
    config: parsedBindingConfig.data,
  };
}

function parsePersistedSecretType(secretType: string): IntegrationCredentialSecretKind | undefined {
  if (secretType === IntegrationCredentialSecretKinds.API_KEY) {
    return IntegrationCredentialSecretKinds.API_KEY;
  }

  if (secretType === IntegrationCredentialSecretKinds.OAUTH_ACCESS_TOKEN) {
    return IntegrationCredentialSecretKinds.OAUTH_ACCESS_TOKEN;
  }

  return undefined;
}

async function resolvePersistedCredential(
  input: ResolvePersistedCredentialInput,
): Promise<ResolvedIntegrationCredential> {
  const credentialPurpose = input.purpose;
  const linkedCredentials = await input.db.query.integrationConnectionCredentials.findMany({
    columns: {
      credentialId: true,
      purpose: true,
    },
    where: (table, { and, eq }) => {
      const connectionFilter = eq(table.connectionId, input.connectionId);
      if (credentialPurpose === undefined) {
        return connectionFilter;
      }

      return and(connectionFilter, eq(table.purpose, credentialPurpose));
    },
  });

  if (linkedCredentials.length === 0) {
    throw new InternalIntegrationCredentialsError(
      InternalIntegrationCredentialsErrorCodes.CREDENTIAL_NOT_FOUND,
      404,
      "No linked integration credential was found for this connection.",
    );
  }

  const matchedCredentials: Array<{
    id: string;
    ciphertext: string;
    nonce: string;
    organizationCredentialKeyVersion: number;
  }> = [];
  const persistedSecretType = parsePersistedSecretType(input.secretType);
  if (persistedSecretType === undefined) {
    throw new InternalIntegrationCredentialsError(
      InternalIntegrationCredentialsErrorCodes.CREDENTIAL_NOT_FOUND,
      404,
      "No active integration credential was found for this secret type.",
    );
  }

  for (const linkedCredential of linkedCredentials) {
    const credential = await input.db.query.integrationCredentials.findFirst({
      columns: {
        id: true,
        ciphertext: true,
        nonce: true,
        organizationCredentialKeyVersion: true,
      },
      where: (table, { and, eq, isNull }) =>
        and(
          eq(table.id, linkedCredential.credentialId),
          eq(table.secretKind, persistedSecretType),
          isNull(table.revokedAt),
        ),
    });

    if (credential !== undefined) {
      matchedCredentials.push(credential);
    }
  }

  if (matchedCredentials.length === 0) {
    throw new InternalIntegrationCredentialsError(
      InternalIntegrationCredentialsErrorCodes.CREDENTIAL_NOT_FOUND,
      404,
      "No active integration credential was found for this secret type.",
    );
  }

  if (matchedCredentials.length > 1) {
    throw new InternalIntegrationCredentialsError(
      InternalIntegrationCredentialsErrorCodes.AMBIGUOUS_CREDENTIAL_MATCH,
      400,
      "Multiple credentials matched. Provide a specific purpose for credential resolution.",
    );
  }

  const credential = matchedCredentials[0];
  if (credential === undefined) {
    throw new Error("Expected matched credential to exist.");
  }

  const organizationCredentialKey = await input.db.query.organizationCredentialKeys.findFirst({
    where: (table, { and, eq }) =>
      and(
        eq(table.organizationId, input.organizationId),
        eq(table.version, credential.organizationCredentialKeyVersion),
      ),
  });

  if (organizationCredentialKey === undefined) {
    throw new Error(
      `Organization credential key version '${String(credential.organizationCredentialKeyVersion)}' for organization '${input.organizationId}' was not found.`,
    );
  }

  const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
    masterKeyVersion: organizationCredentialKey.masterKeyVersion,
    masterEncryptionKeys: input.integrationsConfig.masterEncryptionKeys,
  });
  const unwrappedOrganizationCredentialKey = unwrapOrganizationCredentialKey({
    wrappedCiphertext: organizationCredentialKey.ciphertext,
    masterEncryptionKeyMaterial,
  });

  try {
    const value = decryptCredentialUtf8({
      nonce: credential.nonce,
      ciphertext: credential.ciphertext,
      organizationCredentialKey: unwrappedOrganizationCredentialKey,
    });

    return {
      value,
    };
  } finally {
    unwrappedOrganizationCredentialKey.fill(0);
  }
}

export async function resolveIntegrationCredential(
  db: AppContext["var"]["db"],
  integrationRegistry: AppContext["var"]["integrationRegistry"],
  integrationsConfig: AppContext["var"]["config"]["integrations"],
  input: ResolveIntegrationCredentialInput,
): Promise<ResolvedIntegrationCredential> {
  const connection = await db.query.integrationConnections.findFirst({
    columns: {
      id: true,
      organizationId: true,
      targetKey: true,
      status: true,
      externalSubjectId: true,
      config: true,
    },
    where: (table, { eq }) => eq(table.id, input.connectionId),
  });

  if (connection === undefined) {
    throw new InternalIntegrationCredentialsError(
      InternalIntegrationCredentialsErrorCodes.CONNECTION_NOT_FOUND,
      404,
      `Integration connection '${input.connectionId}' was not found.`,
    );
  }

  if (connection.status !== IntegrationConnectionStatuses.ACTIVE) {
    throw new InternalIntegrationCredentialsError(
      InternalIntegrationCredentialsErrorCodes.CONNECTION_NOT_ACTIVE,
      400,
      `Integration connection '${connection.id}' is not active.`,
    );
  }

  const target = await db.query.integrationTargets.findFirst({
    columns: {
      targetKey: true,
      familyId: true,
      variantId: true,
      enabled: true,
      config: true,
      secrets: true,
    },
    where: (table, { eq }) => eq(table.targetKey, connection.targetKey),
  });

  if (target === undefined) {
    throw new Error(`Integration target '${connection.targetKey}' was not found.`);
  }

  const definition = integrationRegistry.getDefinition({
    familyId: target.familyId,
    variantId: target.variantId,
  });

  if (definition === undefined) {
    throw new Error(
      `Integration definition '${target.familyId}::${target.variantId}' was not found.`,
    );
  }

  if (input.resolverKey !== undefined && input.bindingId === undefined) {
    throw new InternalIntegrationCredentialsError(
      InternalIntegrationCredentialsErrorCodes.BINDING_REQUIRED,
      400,
      "Binding id is required for custom credential resolution.",
    );
  }

  let bindingResolverContext: ResolverContextBinding | undefined;
  if (input.bindingId !== undefined) {
    const [binding] = await db
      .select({
        id: sandboxProfileVersionIntegrationBindings.id,
        kind: sandboxProfileVersionIntegrationBindings.kind,
        connectionId: sandboxProfileVersionIntegrationBindings.connectionId,
        config: sandboxProfileVersionIntegrationBindings.config,
      })
      .from(sandboxProfileVersionIntegrationBindings)
      .where(eq(sandboxProfileVersionIntegrationBindings.id, input.bindingId))
      .limit(1);

    if (binding === undefined) {
      throw new InternalIntegrationCredentialsError(
        InternalIntegrationCredentialsErrorCodes.BINDING_NOT_FOUND,
        404,
        `Integration binding '${input.bindingId}' was not found.`,
      );
    }

    if (binding.connectionId !== connection.id) {
      throw new InternalIntegrationCredentialsError(
        InternalIntegrationCredentialsErrorCodes.BINDING_CONNECTION_MISMATCH,
        400,
        `Integration binding '${binding.id}' does not belong to connection '${connection.id}'.`,
      );
    }

    bindingResolverContext = resolveResolverContextBinding({
      binding: {
        id: binding.id,
        kind: binding.kind,
        config: binding.config,
      },
      definition,
    });
  }

  if (input.resolverKey !== undefined) {
    const customResolver = definition.credentialResolvers?.custom?.[input.resolverKey];
    if (customResolver === undefined) {
      throw new InternalIntegrationCredentialsError(
        InternalIntegrationCredentialsErrorCodes.RESOLVER_NOT_FOUND,
        404,
        `Credential resolver '${input.resolverKey}' was not found for target '${connection.targetKey}'.`,
      );
    }

    const targetResolverContext = resolveResolverContextTarget({
      target,
      definition,
      integrationsConfig,
    });
    const connectionResolverContext = resolveResolverContextConnection({
      id: connection.id,
      status: connection.status,
      externalSubjectId: connection.externalSubjectId,
      config: connection.config,
    });

    return customResolver.resolve({
      organizationId: connection.organizationId,
      targetKey: connection.targetKey,
      connectionId: connection.id,
      target: targetResolverContext,
      connection: connectionResolverContext,
      ...(bindingResolverContext === undefined ? {} : { binding: bindingResolverContext }),
      secretType: input.secretType,
      ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
    });
  }

  const defaultResolver = definition.credentialResolvers?.default;
  if (defaultResolver !== undefined) {
    const targetResolverContext = resolveResolverContextTarget({
      target,
      definition,
      integrationsConfig,
    });
    const connectionResolverContext = resolveResolverContextConnection({
      id: connection.id,
      status: connection.status,
      externalSubjectId: connection.externalSubjectId,
      config: connection.config,
    });

    return defaultResolver.resolve({
      organizationId: connection.organizationId,
      targetKey: connection.targetKey,
      connectionId: connection.id,
      target: targetResolverContext,
      connection: connectionResolverContext,
      ...(bindingResolverContext === undefined ? {} : { binding: bindingResolverContext }),
      secretType: input.secretType,
      ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
    });
  }

  return resolvePersistedCredential({
    db,
    integrationsConfig,
    organizationId: connection.organizationId,
    connectionId: connection.id,
    secretType: input.secretType,
    ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
  });
}
