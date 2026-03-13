import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
  function handleOpenChange(open: boolean): void {
    if (input.isPending) {
      return;
    }

    input.onOpenChange(open);
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={input.isOpen}>
      <DialogContent showCloseButton={!input.isPending}>
        <DialogHeader variant="sectioned">
          <DialogTitle>Delete automation</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm leading-6">
            This removes <span className="font-medium">{input.automationName}</span>.
          </p>

          {input.errorMessage === null ? null : (
            <Alert variant="destructive">
              <AlertTitle>Delete failed</AlertTitle>
              <AlertDescription>{input.errorMessage}</AlertDescription>
            </Alert>
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
            {input.isPending ? "Deleting..." : "Delete automation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
