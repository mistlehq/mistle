import type { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import type {
  IntegrationConnection,
  IntegrationResourceCredentialRef,
} from "@mistle/integrations-core";

export async function resolveResourceCredential(input: {
  connection: IntegrationConnection;
  kind: string;
  credential:
    | IntegrationResourceCredentialRef
    | ((input: {
        connection: IntegrationConnection;
        kind: string;
      }) => IntegrationResourceCredentialRef | undefined)
    | undefined;
  controlPlaneInternalClient: ControlPlaneInternalClient | undefined;
}): Promise<{ value: string; expiresAt?: string } | undefined> {
  const credentialRequirement = resolveResourceCredentialRequirement({
    connection: input.connection,
    kind: input.kind,
    credential: input.credential,
  });
  if (credentialRequirement === undefined) {
    return undefined;
  }

  if (input.controlPlaneInternalClient === undefined) {
    throw new Error("Resource sync credential resolution is not configured.");
  }

  return input.controlPlaneInternalClient.resolveIntegrationCredential({
    connectionId: input.connection.id,
    secretType: credentialRequirement.secretType,
    ...(credentialRequirement.purpose === undefined
      ? {}
      : { purpose: credentialRequirement.purpose }),
    ...(credentialRequirement.resolverKey === undefined
      ? {}
      : { resolverKey: credentialRequirement.resolverKey }),
  });
}

function resolveResourceCredentialRequirement(input: {
  connection: IntegrationConnection;
  kind: string;
  credential:
    | IntegrationResourceCredentialRef
    | ((input: {
        connection: IntegrationConnection;
        kind: string;
      }) => IntegrationResourceCredentialRef | undefined)
    | undefined;
}): IntegrationResourceCredentialRef | undefined {
  if (input.credential === undefined) {
    return undefined;
  }

  if (typeof input.credential === "function") {
    return input.credential({
      connection: input.connection,
      kind: input.kind,
    });
  }

  return input.credential;
}
