import { createRoute } from "@hono/zod-openapi";

import {
  dashboardCapabilitiesResponseHeadersSchema,
  dashboardCapabilitiesResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "get",
  path: "/capabilities",
  tags: ["Dashboard"],
  responses: {
    200: {
      description: "Deployment capabilities exposed to the dashboard.",
      headers: dashboardCapabilitiesResponseHeadersSchema,
      content: {
        "application/json": {
          schema: dashboardCapabilitiesResponseSchema,
        },
      },
    },
  },
});
