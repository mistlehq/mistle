import type { ControlPlaneDatabase, ControlPlaneTransaction } from "@mistle/db/control-plane";

export type ConversationPersistenceDependencies = {
  db: ControlPlaneDatabase | ControlPlaneTransaction;
};
