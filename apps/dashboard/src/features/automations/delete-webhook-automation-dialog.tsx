import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Notice,
} from "@mistle/ui";

type DeleteWebhookAutomationDialogProps = {
  automationName: string;
  errorMessage: string | null;
  isOpen: boolean;
  isPending: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
};

export function DeleteWebhookAutomationDialog(
  input: DeleteWebhookAutomationDialogProps,
): React.JSX.Element {
  return (
    <Dialog
      isBusy={input.isPending}
      isDismissible={!input.isPending}
      onOpenChange={input.onOpenChange}
      open={input.isOpen}
    >
      <DialogContent>
        <DialogHeader variant="sectioned">
          <DialogTitle>Delete trigger</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm leading-6">
            This removes <span className="font-medium">{input.automationName}</span>.
          </p>

          {input.errorMessage === null ? null : (
            <Notice title="Delete failed" variant="alert">
              {input.errorMessage}
            </Notice>
          )}
        </div>

        <DialogFooter>
          <Button
            disabled={input.isPending}
            onClick={() => {
              input.onOpenChange(false);
            }}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button disabled={input.isPending} onClick={input.onConfirm} type="button">
            {input.isPending ? "Deleting..." : "Delete trigger"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
