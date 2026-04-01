import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Notice,
} from "@mistle/ui";
import type { SyntheticEvent } from "react";

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
  function handleSubmit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (input.isPending || input.value.trim().length === 0) {
      return;
    }

    input.onSubmit();
  }

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
        <DialogContent
          formProps={{
            className: "gap-6 grid",
            onSubmit: handleSubmit,
          }}
        >
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
            <Notice variant="alert">{input.errorMessage}</Notice>
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
            <Button disabled={input.isPending || input.value.trim().length === 0} type="submit">
              Update key
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
