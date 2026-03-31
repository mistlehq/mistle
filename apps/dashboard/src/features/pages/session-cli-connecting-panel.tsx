import { SessionPrimaryPanelStatusCard } from "./session-primary-panel-status-card.js";

export function SessionCliConnectingPanel(): React.JSX.Element {
  return (
    <SessionPrimaryPanelStatusCard
      description="Preparing the shared thread and starting the Codex CLI session for this workbench."
      title="Starting Codex CLI..."
    />
  );
}
