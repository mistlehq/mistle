import { index, text, timestamp } from "drizzle-orm/pg-core";

import { dataPlaneSchema } from "./namespace.js";

export const sandboxTunnelTokenRedemptions = dataPlaneSchema.table(
  "sandbox_tunnel_token_redemptions",
  {
    tokenJti: text("token_jti").primaryKey(),
    connectedAt: timestamp("connected_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("sandbox_tunnel_token_redemptions_connected_at_idx").on(table.connectedAt)],
);

export type SandboxTunnelTokenRedemption = typeof sandboxTunnelTokenRedemptions.$inferSelect;
export type InsertSandboxTunnelTokenRedemption = typeof sandboxTunnelTokenRedemptions.$inferInsert;
