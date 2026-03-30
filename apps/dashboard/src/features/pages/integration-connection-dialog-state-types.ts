import type { IntegrationConnectionMethod } from "../integrations/integration-connection-dialog.js";

export type OpenIntegrationConnectionDialogInput =
  | {
      methods: readonly IntegrationConnectionMethod[];
      mode: "create";
      targetDisplayName: string;
      targetKey: string;
    }
  | {
      connectionDisplayName?: string;
      connectionId: string;
      currentMethod: IntegrationConnectionMethod;
      mode: "update";
      targetDisplayName: string;
      targetKey: string;
    };
