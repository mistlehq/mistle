import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@mistle/ui";
import { useCallback } from "react";
import { useBeforeUnload, useBlocker, type BlockerFunction } from "react-router";

type NavigationBlockerDialogProps = {
  enabled: boolean;
  shouldBlockNavigation?: BlockerFunction;
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

export function NavigationBlockerDialog({
  enabled,
  shouldBlockNavigation,
  title = "Discard unsaved changes?",
  description = "Your changes will be discarded if you leave this page.",
  confirmLabel = "Discard changes",
  cancelLabel = "Stay on page",
}: NavigationBlockerDialogProps): React.JSX.Element {
  const shouldBlock = useCallback<BlockerFunction>(
    (navigation) => enabled && (shouldBlockNavigation?.(navigation) ?? true),
    [enabled, shouldBlockNavigation],
  );
  const blocker = useBlocker(shouldBlock);

  useBeforeUnload((event) => {
    if (!enabled) {
      return;
    }
    event.preventDefault();
    // oxlint-disable-next-line typescript-eslint/no-deprecated -- Chromium/WebKit still require returnValue for beforeunload confirmation.
    event.returnValue = "";
  });

  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) {
          blocker.reset?.();
        }
      }}
      open={blocker.state === "blocked"}
    >
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={() => {
              blocker.reset?.();
            }}
          >
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              blocker.proceed?.();
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
