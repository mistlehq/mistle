import { z } from "@hono/zod-openapi";
import { createCodeMessageErrorSchema } from "@mistle/http/errors.js";

import { SandboxInstancesConflictCodes } from "../constants.js";

export const conflictResponseSchema = createCodeMessageErrorSchema(
  z.enum([
    SandboxInstancesConflictCodes.INSTANCE_FAILED,
    SandboxInstancesConflictCodes.INSTANCE_NOT_RESUMABLE,
  ]),
);
