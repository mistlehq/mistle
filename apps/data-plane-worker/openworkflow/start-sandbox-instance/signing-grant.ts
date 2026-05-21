import { mintSigningGrant } from "@mistle/sandbox-signing-auth";
import type { StartSandboxInstanceWorkflowInput } from "@mistle/workflow-registry/data-plane";

import type { DataPlaneWorkerRuntimeConfig } from "../core/config.js";

const SandboxSigningGrantTtlSeconds = 60 * 60 * 24;

export async function createSigningGrant(input: {
  config: DataPlaneWorkerRuntimeConfig;
  sandboxInstanceId: string;
  gitIdentity?: StartSandboxInstanceWorkflowInput["gitIdentity"];
}): Promise<string | undefined> {
  const signing = input.gitIdentity?.signing;
  if (signing === undefined) {
    return undefined;
  }

  return mintSigningGrant({
    config: {
      tokenSecret: input.config.sandbox.bootstrap.tokenSecret,
      tokenIssuer: input.config.sandbox.bootstrap.tokenIssuer,
      tokenAudience: input.config.sandbox.bootstrap.tokenAudience,
    },
    claims: {
      sub: input.sandboxInstanceId,
      jti: signing.keyRef,
      organizationId: signing.organizationId,
      actingUserId: signing.actingUserId,
      providerFamily: signing.providerFamily,
      integrationConnectionId: signing.integrationConnectionId,
      format: signing.format,
      keyRef: signing.keyRef,
    },
    ttlSeconds: SandboxSigningGrantTtlSeconds,
  });
}
