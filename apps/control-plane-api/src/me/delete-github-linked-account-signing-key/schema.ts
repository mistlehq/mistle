import { z } from "@hono/zod-openapi";
import { createCodeMessageErrorSchema } from "@mistle/http/errors.js";

import {
  IdentityLinkingBadRequestCodes,
  IdentityLinkingNotFoundCodes,
} from "../../identity-linking/constants.js";

export const DeleteGitHubLinkedAccountSigningKeyBadRequestResponseSchema =
  createCodeMessageErrorSchema(z.literal(IdentityLinkingBadRequestCodes.PROVIDER_CONFIG_AMBIGUOUS));

export const DeleteGitHubLinkedAccountSigningKeyNotFoundResponseSchema =
  createCodeMessageErrorSchema(
    z.union([
      z.literal(IdentityLinkingNotFoundCodes.LINKED_ACCOUNT_NOT_FOUND),
      z.literal(IdentityLinkingNotFoundCodes.LINKED_ACCOUNT_SIGNING_KEY_NOT_FOUND),
    ]),
  );
