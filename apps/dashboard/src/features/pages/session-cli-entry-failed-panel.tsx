import { SessionPrimaryPanelStatusCard } from "./session-primary-panel-status-card.js";

type SessionCliEntryFailedPanelProps = {
  errorMessage: string | null;
  onReturnToChat: () => void;
};

export function SessionCliEntryFailedPanel(
  props: SessionCliEntryFailedPanelProps,
): React.JSX.Element {
  return (
    <SessionPrimaryPanelStatusCard
      action={{
        label: "Return to chat",
        onClick: props.onReturnToChat,
      }}
      description={
        props.errorMessage ??
        "Codex CLI could not be started for this session. Return to chat to keep using the workbench."
      }
      title="Could not start Codex CLI"
      tone="destructive"
    />
  );
}
