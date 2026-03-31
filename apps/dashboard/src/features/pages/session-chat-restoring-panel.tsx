import { SessionPrimaryPanelStatusCard } from "./session-primary-panel-status-card.js";

export function SessionChatRestoringPanel(): React.JSX.Element {
  return (
    <SessionPrimaryPanelStatusCard
      description="Reconnecting the session transport and rebuilding the current thread."
      title="Restoring chat..."
    />
  );
}
