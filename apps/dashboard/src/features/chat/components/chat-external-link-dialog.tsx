import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@mistle/ui";
import { CopyableValue } from "@mistle/ui";
import { ArrowSquareOutIcon } from "@phosphor-icons/react";

type ChatExternalLinkDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  url: string;
};

export function ChatExternalLinkDialog({
  isOpen,
  onClose,
  onConfirm,
  url,
}: ChatExternalLinkDialogProps): React.JSX.Element {
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open={isOpen}
    >
      <DialogContent className="sm:max-w-2xl" showCloseButton>
        <DialogHeader className="gap-3" variant="sectioned">
          <DialogTitle>Open external link?</DialogTitle>
        </DialogHeader>

        <CopyableValue
          copiedTitle="Copied link"
          copyAriaLabel="Copy link"
          copyTitle="Copy link"
          failureMessage="Could not copy the link automatically."
          value={url}
          variant="inline"
        />

        <DialogFooter>
          <Button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            type="button"
          >
            <ArrowSquareOutIcon aria-hidden className="size-4" />
            Open link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
