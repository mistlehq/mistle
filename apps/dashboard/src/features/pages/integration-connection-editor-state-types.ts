import type { IntegrationConnectionMethod } from "../integrations/integrations-service-shared.js";

type BaseOpenIntegrationConnectionEditorInput = {
  targetConfig: Record<string, unknown>;
  targetDisplayName: string;
  targetFamilyId: string;
  targetKey: string;
  targetVariantId: string;
};

export type OpenIntegrationConnectionEditorInput =
  | (BaseOpenIntegrationConnectionEditorInput & {
      methods: readonly IntegrationConnectionMethod[];
      mode: "create";
    })
  | (BaseOpenIntegrationConnectionEditorInput & {
      connectionConfig?: Record<string, unknown>;
      connectionDisplayName?: string;
      connectionId: string;
      currentMethod: IntegrationConnectionMethod;
      mode: "update";
    });
