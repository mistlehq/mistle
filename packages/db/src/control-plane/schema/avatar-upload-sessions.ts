import { bigint, text, timestamp } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { controlPlaneSchema } from "./namespace.js";

export const AvatarUploadSubjectKinds = {
  USER: "user",
  ORGANIZATION: "organization",
} as const;

export type AvatarUploadSubjectKind =
  (typeof AvatarUploadSubjectKinds)[keyof typeof AvatarUploadSubjectKinds];

export const avatarUploadSessions = controlPlaneSchema.table("avatar_upload_sessions", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => typeid("aus").toString()),
  actorUserId: text("actor_user_id").notNull(),
  subjectKind: text("subject_kind").notNull(),
  subjectId: text("subject_id").notNull(),
  temporaryObjectKey: text("temporary_object_key").notNull(),
  sourceContentType: text("source_content_type").notNull(),
  sourceFileSize: bigint("source_file_size", { mode: "number" }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
