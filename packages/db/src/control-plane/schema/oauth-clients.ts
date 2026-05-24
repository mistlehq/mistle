import { text, timestamp, uniqueIndex, type PgSchema } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { controlPlaneSchema } from "./namespace.js";

export const OAuthClientTypes = {
  PUBLIC: "public",
  CONFIDENTIAL: "confidential",
} as const;

export type OAuthClientType = (typeof OAuthClientTypes)[keyof typeof OAuthClientTypes];

export const OAuthApplicationTypes = {
  NATIVE: "native",
  WEB: "web",
} as const;

export type OAuthApplicationType =
  (typeof OAuthApplicationTypes)[keyof typeof OAuthApplicationTypes];

export const OAuthClientRegistrationKinds = {
  STATIC: "static",
  DYNAMIC: "dynamic",
} as const;

export type OAuthClientRegistrationKind =
  (typeof OAuthClientRegistrationKinds)[keyof typeof OAuthClientRegistrationKinds];

export function defineOAuthClients(schema: PgSchema) {
  return schema.table(
    "oauth_clients",
    {
      id: text("id")
        .primaryKey()
        .$defaultFn(() => typeid("oac").toString()),
      clientId: text("client_id").notNull(),
      name: text("name").notNull(),
      clientType: text("client_type").$type<OAuthClientType>().notNull(),
      applicationType: text("application_type").$type<OAuthApplicationType>().notNull(),
      registrationKind: text("registration_kind").$type<OAuthClientRegistrationKind>().notNull(),
      clientSecretHash: text("client_secret_hash"),
      clientSecretHashAlgorithm: text("client_secret_hash_algorithm"),
      disabledAt: timestamp("disabled_at", { withTimezone: true, mode: "string" }),
      createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
    },
    (table) => [uniqueIndex("oauth_clients_client_id_uidx").on(table.clientId)],
  );
}

export const oauthClients = defineOAuthClients(controlPlaneSchema);

export type OAuthClient = typeof oauthClients.$inferSelect;
export type InsertOAuthClient = typeof oauthClients.$inferInsert;
