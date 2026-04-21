import { createRoute } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { DeleteGitHubLinkedAccountSigningKeyNotFoundResponseSchema } from "./schema.js";

export const route = createRoute({
  method: "delete",
  path: "/linked-accounts/github/signing-key",
  tags: ["Me"],
  responses: {
    204: {
      description: "Remove the authenticated user's GitHub SSH signing key.",
    },
    401: {
      description: "Authentication is required.",
      content: {
        "application/json": {
          schema: UnauthorizedResponseSchema,
        },
      },
    },
    404: {
      description: "GitHub linked account or signing key was not found.",
      content: {
        "application/json": {
          schema: DeleteGitHubLinkedAccountSigningKeyNotFoundResponseSchema,
        },
      },
    },
  },
});
