import type { CodexSessionConnectionState } from "@mistle/codex-app-server-client";
import { DropdownMenuItem } from "@mistle/ui";
import { useState } from "react";

import { MoreActionsMenu } from "../../components/more-actions-menu.js";
import type { ConnectedCodexSession } from "../codex-client/codex-session-types.js";
import { SessionConfigDialog } from "./session-config-dialog.js";

export function SessionMoreActions(input: {
  sandboxInstanceId: string | null;
  agentConnectionState: CodexSessionConnectionState;
  connectedSession: ConnectedCodexSession | null;
  configJson: string | null;
  configRequirementsJson: string | null;
  isReadingConfig: boolean;
  isReadingConfigRequirements: boolean;
  onLoadConfigSetup: () => void;
}): React.JSX.Element {
  const [isConfigDialogOpen, setIsConfigDialogOpen] = useState(false);
  const hasConnectedSession = input.connectedSession !== null;

  function openConfigDialog(): void {
    setIsConfigDialogOpen(true);
    input.onLoadConfigSetup();
  }

  return (
    <>
      <MoreActionsMenu
        disabled={!hasConnectedSession}
        triggerLabel="Session actions"
        triggerSize="icon-sm"
      >
        <DropdownMenuItem onClick={openConfigDialog}>View config setup</DropdownMenuItem>
      </MoreActionsMenu>

      <SessionConfigDialog
        agentConnectionState={input.agentConnectionState}
        configJson={input.configJson}
        configRequirementsJson={input.configRequirementsJson}
        connectedSession={input.connectedSession}
        isOpen={isConfigDialogOpen}
        isReadingConfig={input.isReadingConfig}
        isReadingConfigRequirements={input.isReadingConfigRequirements}
        onOpenChange={setIsConfigDialogOpen}
        sandboxInstanceId={input.sandboxInstanceId}
      />
    </>
  );
}
