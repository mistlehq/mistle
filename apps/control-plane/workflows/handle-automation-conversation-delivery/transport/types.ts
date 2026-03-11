import type { PreparedAutomationRun } from "../../handle-automation-run/index.js";
import type { AcquiredAutomationConnection, EnsuredAutomationSandbox } from "../index.js";

export type DeliverAutomationPayloadInput = {
  preparedAutomationRun: PreparedAutomationRun;
  ensuredAutomationSandbox: EnsuredAutomationSandbox;
  acquiredAutomationConnection: AcquiredAutomationConnection;
};
