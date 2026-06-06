import { z } from "@hono/zod-openapi";
import { createCodeMessageErrorSchema } from "@mistle/http/errors.js";

import { SandboxProfilesCompileErrorCodes } from "../errors.js";
import { badRequestResponseSchema as startSandboxProfileInstanceBadRequestResponseSchema } from "../start-sandbox-profile-instance/schema.js";

export const badRequestResponseSchema = z.union([
  startSandboxProfileInstanceBadRequestResponseSchema,
  createCodeMessageErrorSchema(
    z.enum([SandboxProfilesCompileErrorCodes.AGENT_RUNTIME_CONNECTION_REQUIRED]),
  ),
]);
