import type { IntegrationConnectionMethodId } from "../integrations/integration-connection-dialog.js";

export type OpenIntegrationConnectionDialogInput =
  | {
      methods: readonly IntegrationConnectionMethodId[];
      mode: "create";
      targetDisplayName: string;
      targetKey: string;
    }
  | {
      connectionDisplayName?: string;
      connectionId: string;
      currentMethodId: IntegrationConnectionMethodId;
      mode: "update";
      targetDisplayName: string;
      targetKey: string;
    };
