import { SessionPrimaryPanelStatusCard } from "./session-primary-panel-status-card.js";

type SessionChatRestoreFailedPanelProps = {
  errorMessage: string | null;
  onRetry: () => void;
};

export function SessionChatRestoreFailedPanel(
  props: SessionChatRestoreFailedPanelProps,
): React.JSX.Element {
  return (
    <SessionPrimaryPanelStatusCard
      action={{
        label: "Retry restoring chat",
        onClick: props.onRetry,
      }}
      description={
        props.errorMessage ??
        "The workbench could not reconnect chat automatically. Retry restoring chat to continue in the current thread."
      }
      title="Could not restore chat"
      tone="destructive"
    />
  );
}
