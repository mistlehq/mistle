import { type ControlPlaneDatabase } from "@mistle/db/control-plane";
import { type IntegrationRegistry } from "@mistle/integrations-core";
import { SlackConnectionMethodId } from "@mistle/integrations-definitions";

import { buildIntegrationConnectionResponse } from "../../services/build-integration-connection-response.js";
import { createDraftFormConnection } from "../../services/create-draft-form-connection.js";

type CreateSlackAppDraftConnectionInput = {
  organizationId: string;
  targetKey: string;
  displayName: string;
};

export async function createSlackAppDraftConnection(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
  },
  input: CreateSlackAppDraftConnectionInput,
): Promise<ReturnType<typeof buildIntegrationConnectionResponse>> {
  return await createDraftFormConnection(ctx, {
    organizationId: input.organizationId,
    targetKey: input.targetKey,
    methodId: SlackConnectionMethodId,
    displayName: input.displayName,
  });
}
