import { createRequireAuthSessionMiddleware } from "../middleware/require-auth-session.js";

export const ProtectedIntegrationConnectionsRouteMiddleware = [
  createRequireAuthSessionMiddleware(),
] satisfies [ReturnType<typeof createRequireAuthSessionMiddleware>];
