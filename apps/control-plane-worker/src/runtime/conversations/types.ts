import type { ControlPlaneDatabase } from "@mistle/db/control-plane";

export type ConversationPersistenceDependencies = {
  db: ControlPlaneDatabase;
};
