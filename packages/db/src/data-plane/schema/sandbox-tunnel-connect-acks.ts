import { index, text, timestamp } from "drizzle-orm/pg-core";

import { dataPlaneSchema } from "./namespace.js";

export const sandboxTunnelConnectAcks = dataPlaneSchema.table(
  "sandbox_tunnel_connect_acks",
  {
    bootstrapTokenJti: text("bootstrap_token_jti").primaryKey(),
    connectedAt: timestamp("connected_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("sandbox_tunnel_connect_acks_connected_at_idx").on(table.connectedAt)],
);

export type SandboxTunnelConnectAck = typeof sandboxTunnelConnectAcks.$inferSelect;
export type InsertSandboxTunnelConnectAck = typeof sandboxTunnelConnectAcks.$inferInsert;
