import { type ControlPlaneDatabase } from "@mistle/db/control-plane";
import {
  IntegrationConnectionMethodIds,
  type IntegrationRegistry,
} from "@mistle/integrations-core";

import { buildIntegrationConnectionResponse } from "../../services/build-integration-connection-response.js";
import { createDraftFormConnection } from "../../services/create-draft-form-connection.js";

type CreateGitHubAppDraftConnectionInput = {
  organizationId: string;
  targetKey: string;
  displayName: string;
};

export async function createGitHubAppDraftConnection(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
  },
  input: CreateGitHubAppDraftConnectionInput,
): Promise<ReturnType<typeof buildIntegrationConnectionResponse>> {
  return await createDraftFormConnection(ctx, {
    organizationId: input.organizationId,
    targetKey: input.targetKey,
    methodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
    displayName: input.displayName,
  });
}
