import type { CodexSessionConnectionState } from "@mistle/integrations-definitions/openai/agent/client";
import { DropdownMenuItem, MoreActionsMenu } from "@mistle/ui";

import type { ConnectedCodexSession } from "../codex-client/codex-session-types.js";
import { SessionConfigDialog } from "./session-config-dialog.js";

type SessionMoreActionsViewProps = {
  sandboxInstanceId: string | null;
  agentConnectionState: CodexSessionConnectionState;
  connectedSession: ConnectedCodexSession | null;
  configJson: string | null;
  configRequirementsJson: string | null;
  isReadingConfig: boolean;
  isReadingConfigRequirements: boolean;
  isConfigDialogOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenConfigSetup: () => void;
};

export function SessionMoreActionsView(input: SessionMoreActionsViewProps): React.JSX.Element {
  const hasConnectedSession = input.connectedSession !== null;

  function handleViewConfigSetup(): void {
    input.onOpenChange(true);
    input.onOpenConfigSetup();
  }

  return (
    <>
      <MoreActionsMenu
        disabled={!hasConnectedSession}
        triggerLabel="Session actions"
        triggerSize="icon-sm"
      >
        <DropdownMenuItem onClick={handleViewConfigSetup}>View config setup</DropdownMenuItem>
      </MoreActionsMenu>

      <SessionConfigDialog
        agentConnectionState={input.agentConnectionState}
        configJson={input.configJson}
        configRequirementsJson={input.configRequirementsJson}
        connectedSession={input.connectedSession}
        isOpen={input.isConfigDialogOpen}
        isReadingConfig={input.isReadingConfig}
        isReadingConfigRequirements={input.isReadingConfigRequirements}
        onOpenChange={input.onOpenChange}
        sandboxInstanceId={input.sandboxInstanceId}
      />
    </>
  );
}
