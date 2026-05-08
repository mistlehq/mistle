import {
  PruneExpiredAuthStateCommand,
  PruneExpiredAuthStateCommandName,
} from "./prune-expired-auth-state.js";
import {
  PruneExpiredIntegrationAuthStateCommand,
  PruneExpiredIntegrationAuthStateCommandName,
} from "./prune-expired-integration-auth-state.js";
import {
  PruneStaleOpenWorkflowRunsCommand,
  PruneStaleOpenWorkflowRunsCommandName,
} from "./prune-stale-openworkflow-runs.js";
import type { MaintenanceCommandDefinition } from "./types.js";

export function resolveMaintenanceCommand(commandName: string): MaintenanceCommandDefinition {
  if (commandName === PruneExpiredAuthStateCommandName) {
    return PruneExpiredAuthStateCommand;
  }

  if (commandName === PruneExpiredIntegrationAuthStateCommandName) {
    return PruneExpiredIntegrationAuthStateCommand;
  }

  if (commandName === PruneStaleOpenWorkflowRunsCommandName) {
    return PruneStaleOpenWorkflowRunsCommand;
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
  PruneStaleOpenWorkflowRunsCommand,
  PruneStaleOpenWorkflowRunsCommandName,
} from "./prune-stale-openworkflow-runs.js";
export type {
  MaintenanceCommandContext,
  MaintenanceCommandDefinition,
  MaintenanceCommandResult,
} from "./types.js";
