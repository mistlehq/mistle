import type { ControlPlaneDatabase, ControlPlaneTransaction } from "@mistle/db/control-plane";

export type AutomationConversationPersistenceDependencies = {
  db: ControlPlaneDatabase | ControlPlaneTransaction;
};
