import type { ControlPlaneDatabase, OAuthGrantType } from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";

import { MistleCliOAuthClient } from "../clients.js";
import { OAuthErrorCodes } from "./authorization-code.js";
import { requireOAuthClient } from "./client-validation.js";

export async function requireMistleCliOAuthClient(input: {
  db: ControlPlaneDatabase;
  clientId: string;
  grantType: OAuthGrantType;
}): Promise<{
  id: string;
  permissions: Awaited<ReturnType<typeof requireOAuthClient>>["permissions"];
}> {
  if (input.clientId !== MistleCliOAuthClient.clientId) {
    throw new BadRequestError(OAuthErrorCodes.UNAUTHORIZED_CLIENT, "OAuth client is not allowed.");
  }

  return await requireOAuthClient(input);
}

export async function validateMistleCliRedirectUri(input: {
  db: ControlPlaneDatabase;
  redirectUri: string;
}): Promise<void> {
  await requireOAuthClient({
    db: input.db,
    clientId: MistleCliOAuthClient.clientId,
    grantType: "authorization_code",
    redirectUri: input.redirectUri,
  });
}
