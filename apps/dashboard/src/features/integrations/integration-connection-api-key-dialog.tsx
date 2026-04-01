import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@mistle/ui";

import { StatusBox } from "../shared/status-box.js";

export function IntegrationConnectionApiKeyDialog(input: {
  connectionDisplayName: string;
  errorMessage?: string;
  isOpen: boolean;
  isPending: boolean;
  onClose: () => void;
  onSubmit: () => void;
  onValueChange: (nextValue: string) => void;
  value: string;
}): React.JSX.Element {
  return (
    <Dialog
      isBusy={input.isPending}
      isDismissible={!input.isPending}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          input.onClose();
        }
      }}
      open={input.isOpen}
    >
      {input.isOpen ? (
        <DialogContent>
          <DialogHeader variant="sectioned">
            <DialogTitle>{`Update ${input.connectionDisplayName}`}</DialogTitle>
          </DialogHeader>

          <div className="gap-2 flex flex-col">
            <Input
              aria-invalid={input.errorMessage === undefined ? undefined : true}
              autoComplete="off"
              data-1p-ignore="true"
              onChange={(event) => {
                input.onValueChange(event.currentTarget.value);
              }}
              placeholder="Enter new API key"
              type="password"
              value={input.value}
            />
          </div>

          {input.errorMessage === undefined ? null : (
            <StatusBox tone="destructive">{input.errorMessage}</StatusBox>
          )}

          <DialogFooter>
            <Button
              disabled={input.isPending}
              onClick={input.onClose}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={input.isPending || input.value.trim().length === 0}
              onClick={input.onSubmit}
              type="button"
            >
              Update key
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
