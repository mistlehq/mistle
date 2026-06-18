import { DesignerActionRequestStatuses } from "@mistle/db/control-plane";
import { describe, expect, it } from "vitest";

import { executeApprovedDesignerOperation } from "./designer-operation-handlers.js";

describe("Designer operation handlers", () => {
  it("fails closed for provider configuration changes until an explicit handler is registered", async () => {
    await expect(
      executeApprovedDesignerOperation({
        actionRequestId: "dar_unsupported_provider_configuration_change",
        organizationId: "org_designer_operation_handler",
        sessionId: "dsn_designer_operation_handler",
        proposalId: "dap_github_label",
        operation: {
          kind: "providerConfigurationChange",
          provider: "github",
          resourceType: "label",
          resourceLabel: "mistlehq/mistle",
          action: "Create label",
          details: [
            {
              label: "Label",
              value: "ai-triage",
            },
          ],
        },
      }),
    ).resolves.toEqual({
      status: DesignerActionRequestStatuses.EXECUTION_UNSUPPORTED,
      failureCode: "DESIGNER_OPERATION_HANDLER_UNSUPPORTED",
      failureMessage:
        "Designer operation kind 'providerConfigurationChange' does not have an execution handler.",
    });
  });
});
