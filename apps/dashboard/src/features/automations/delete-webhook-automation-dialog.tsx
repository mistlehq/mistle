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
  return (
    <Dialog onOpenChange={input.onOpenChange} open={input.isOpen}>
      <DialogContent showCloseButton={!input.isPending}>
        <DialogHeader variant="sectioned">
          <DialogTitle>Delete automation</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm leading-6">
            Delete <span className="font-medium">{input.automationName}</span>? This removes the
            automation configuration immediately.
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
