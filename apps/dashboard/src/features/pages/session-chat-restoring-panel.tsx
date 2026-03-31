import { SessionPrimaryPanelStatusCard } from "./session-primary-panel-status-card.js";

export function SessionChatRestoringPanel(): React.JSX.Element {
  return (
    <SessionPrimaryPanelStatusCard
      description="Rebuilding chat after leaving the shared Codex CLI session."
      title="Restoring chat..."
    />
  );
}
