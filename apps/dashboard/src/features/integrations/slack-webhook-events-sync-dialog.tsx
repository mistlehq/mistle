import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldContent,
  FieldDescription,
  FieldHeader,
  FieldLabel,
  Input,
  Notice,
  TextLink,
} from "@mistle/ui";
import { useState, type SyntheticEvent } from "react";

export function SlackWebhookEventsSyncDialog(input: {
  errorMessage: string | null;
  isOpen: boolean;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onSync: (appConfigToken: string) => void;
}): React.JSX.Element {
  const [appConfigToken, setAppConfigToken] = useState("");
  const trimmedAppConfigToken = appConfigToken.trim();

  function handleOpenChange(open: boolean): void {
    if (!open) {
      setAppConfigToken("");
    }

    input.onOpenChange(open);
  }

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (input.isPending || trimmedAppConfigToken.length === 0) {
      return;
    }

    input.onSync(trimmedAppConfigToken);
    setAppConfigToken("");
  }

  return (
    <Dialog
      isBusy={input.isPending}
      isDismissible={!input.isPending}
      onOpenChange={handleOpenChange}
      open={input.isOpen}
    >
      {input.isOpen ? (
        <DialogContent
          className="sm:max-w-xl"
          formProps={{
            className: "gap-6 grid",
            onSubmit: handleSubmit,
          }}
        >
          <DialogHeader>
            <DialogTitle>Sync webhook events</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            {input.errorMessage === null ? null : (
              <Notice title="Could not sync webhook events" variant="alert">
                {input.errorMessage}
              </Notice>
            )}

            <Field>
              <FieldHeader>
                <FieldLabel htmlFor="slack-webhook-events-sync-token" required>
                  App configuration token
                </FieldLabel>
                <FieldDescription>
                  Generate a temporary token from{" "}
                  <TextLink href="https://api.slack.com/apps" opensInNewWindow>
                    https://api.slack.com/apps
                  </TextLink>{" "}
                  and paste it below
                </FieldDescription>
              </FieldHeader>
              <FieldContent>
                <Input
                  autoComplete="off"
                  data-1p-ignore="true"
                  disabled={input.isPending}
                  id="slack-webhook-events-sync-token"
                  onChange={(event) => {
                    setAppConfigToken(event.currentTarget.value);
                  }}
                  placeholder="xoxe.xoxp-..."
                  type="password"
                  value={appConfigToken}
                />
              </FieldContent>
            </Field>
          </div>

          <DialogFooter>
            <Button
              disabled={input.isPending}
              onClick={() => {
                handleOpenChange(false);
              }}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={input.isPending || trimmedAppConfigToken.length === 0} type="submit">
              {input.isPending ? "Syncing..." : "Sync"}
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
