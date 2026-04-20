import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@mistle/ui";
import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import type { LinkSafetyModalProps } from "streamdown";

import { CopyableValue } from "../../shared/copyable-value.js";

export function ChatMarkdownLinkSafetyDialog({
  isOpen,
  onClose,
  onConfirm,
  url,
}: LinkSafetyModalProps): React.JSX.Element | null {
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
          label="Link"
          value={url}
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
