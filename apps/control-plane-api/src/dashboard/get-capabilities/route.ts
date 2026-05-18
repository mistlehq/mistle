import { createRoute } from "@hono/zod-openapi";

import { dashboardCapabilitiesResponseSchema } from "./schema.js";

export const route = createRoute({
  method: "get",
  path: "/capabilities",
  tags: ["Dashboard"],
  responses: {
    200: {
      description: "Deployment capabilities exposed to the dashboard.",
      content: {
        "application/json": {
          schema: dashboardCapabilitiesResponseSchema,
        },
      },
    },
  },
});
