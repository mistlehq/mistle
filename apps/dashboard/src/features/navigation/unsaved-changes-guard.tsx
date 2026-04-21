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
import { useBeforeUnload, useBlocker } from "react-router";

type UnsavedChangesGuardProps = {
  when: boolean;
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

export function UnsavedChangesGuard({
  when,
  title = "Discard unsaved changes?",
  description = "Your changes will be discarded if you leave this page.",
  confirmLabel = "Discard changes",
  cancelLabel = "Stay on page",
}: UnsavedChangesGuardProps): React.JSX.Element {
  const blocker = useBlocker(when);

  useBeforeUnload((event) => {
    if (!when) {
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
