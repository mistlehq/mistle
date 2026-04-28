import {
  PruneExpiredAuthStateCommand,
  PruneExpiredAuthStateCommandName,
} from "./prune-expired-auth-state.js";
import {
  PruneExpiredIntegrationAuthStateCommand,
  PruneExpiredIntegrationAuthStateCommandName,
} from "./prune-expired-integration-auth-state.js";
import type { MaintenanceCommandDefinition } from "./types.js";

export function resolveMaintenanceCommand(commandName: string): MaintenanceCommandDefinition {
  if (commandName === PruneExpiredAuthStateCommandName) {
    return PruneExpiredAuthStateCommand;
  }

  if (commandName === PruneExpiredIntegrationAuthStateCommandName) {
    return PruneExpiredIntegrationAuthStateCommand;
  }

  throw new Error(`Unknown maintenance command '${commandName}'.`);
}

export {
  PruneExpiredAuthStateCommand,
  PruneExpiredAuthStateCommandName,
} from "./prune-expired-auth-state.js";
export {
  PruneExpiredIntegrationAuthStateCommand,
  PruneExpiredIntegrationAuthStateCommandName,
} from "./prune-expired-integration-auth-state.js";
export type {
  MaintenanceCommandContext,
  MaintenanceCommandDefinition,
  MaintenanceCommandResult,
} from "./types.js";
