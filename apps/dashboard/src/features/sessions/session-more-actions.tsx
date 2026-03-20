import type { CodexSessionConnectionState } from "@mistle/integrations-definitions/openai/agent/client";
import { useState } from "react";

import type { ConnectedCodexSession } from "../session-agents/codex/session-state/index.js";
import { SessionMoreActionsView } from "./session-more-actions-view.js";

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

  return (
    <SessionMoreActionsView
      agentConnectionState={input.agentConnectionState}
      configJson={input.configJson}
      configRequirementsJson={input.configRequirementsJson}
      connectedSession={input.connectedSession}
      isConfigDialogOpen={isConfigDialogOpen}
      isReadingConfig={input.isReadingConfig}
      isReadingConfigRequirements={input.isReadingConfigRequirements}
      onOpenChange={setIsConfigDialogOpen}
      onOpenConfigSetup={input.onLoadConfigSetup}
      sandboxInstanceId={input.sandboxInstanceId}
    />
  );
}
