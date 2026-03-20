import { Button } from "@mistle/ui";

type ApprovalDecisionButtonsProps = {
  appearance: "compact" | "panel";
  availableDecisions: readonly string[];
  disabled: boolean;
  onRespondToServerRequest: (requestId: string | number, result: unknown) => void;
  requestId: string | number;
};

export function ApprovalDecisionButtons({
  appearance,
  availableDecisions,
  disabled,
  onRespondToServerRequest,
  requestId,
}: ApprovalDecisionButtonsProps): React.JSX.Element {
  return (
    <div className="flex flex-wrap gap-2">
      {availableDecisions.map((decision) => {
        const response = { decision };

        if (appearance === "panel") {
          return (
            <Button
              disabled={disabled}
              key={decision}
              onClick={() => {
                onRespondToServerRequest(requestId, response);
              }}
              type="button"
              variant={decision.startsWith("accept") ? "default" : "outline"}
            >
              {decision}
            </Button>
          );
        }

        return (
          <button
            className="rounded-md border px-3 py-1.5 font-medium text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled}
            key={decision}
            onClick={() => {
              onRespondToServerRequest(requestId, response);
            }}
            type="button"
          >
            {decision}
          </button>
        );
      })}
    </div>
  );
}
