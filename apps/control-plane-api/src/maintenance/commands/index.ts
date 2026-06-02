import {
  PruneExpiredAuthStateCommand,
  PruneExpiredAuthStateCommandName,
} from "./prune-expired-auth-state.js";
import {
  PruneExpiredIntegrationAuthStateCommand,
  PruneExpiredIntegrationAuthStateCommandName,
} from "./prune-expired-integration-auth-state.js";
import {
  PruneSandboxOperationEventsCommand,
  PruneSandboxOperationEventsCommandName,
} from "./prune-sandbox-operation-events.js";
import type { MaintenanceCommandDefinition } from "./types.js";

export function resolveMaintenanceCommand(commandName: string): MaintenanceCommandDefinition {
  if (commandName === PruneExpiredAuthStateCommandName) {
    return PruneExpiredAuthStateCommand;
  }

  if (commandName === PruneExpiredIntegrationAuthStateCommandName) {
    return PruneExpiredIntegrationAuthStateCommand;
  }

  if (commandName === PruneSandboxOperationEventsCommandName) {
    return PruneSandboxOperationEventsCommand;
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
export {
  PruneSandboxOperationEventsCommand,
  PruneSandboxOperationEventsCommandName,
} from "./prune-sandbox-operation-events.js";
export type {
  ControlPlaneMaintenanceCommandContext,
  DataPlaneMaintenanceCommandContext,
  MaintenanceCommandContext,
  MaintenanceCommandDatabase,
  MaintenanceCommandDefinition,
  MaintenanceCommandResult,
} from "./types.js";
