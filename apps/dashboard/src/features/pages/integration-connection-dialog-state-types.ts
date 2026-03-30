import type { IntegrationConnectionMethod } from "../integrations/integrations-service-shared.js";

type BaseOpenIntegrationConnectionDialogInput = {
  targetConfig: Record<string, unknown>;
  targetDisplayName: string;
  targetFamilyId: string;
  targetKey: string;
  targetVariantId: string;
};

export type OpenIntegrationConnectionDialogInput =
  | (BaseOpenIntegrationConnectionDialogInput & {
      methods: readonly IntegrationConnectionMethod[];
      mode: "create";
    })
  | (BaseOpenIntegrationConnectionDialogInput & {
      connectionConfig?: Record<string, unknown>;
      connectionDisplayName?: string;
      connectionId: string;
      currentMethod: IntegrationConnectionMethod;
      mode: "update";
    });
