import { SessionPrimaryPanelStatusCard } from "./session-primary-panel-status-card.js";

type SessionChatRestoreFailedPanelProps = {
  errorMessage: string | null;
};

export function SessionChatRestoreFailedPanel(
  props: SessionChatRestoreFailedPanelProps,
): React.JSX.Element {
  return (
    <SessionPrimaryPanelStatusCard
      description={
        props.errorMessage ??
        "The workbench could not reconnect chat automatically. Please try again later or contact support if the problem continues."
      }
      title="Could not restore chat"
      tone="destructive"
    />
  );
}
