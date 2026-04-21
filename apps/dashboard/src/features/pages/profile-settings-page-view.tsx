import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldContent,
  FieldHeader,
  FieldLabel,
  Input,
  Notice,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@mistle/ui";
import type { SyntheticEvent } from "react";
import { useEffect, useRef, useState } from "react";

import { AutoSaveTextField } from "../forms/auto-save-text-field.js";
import { resolveIntegrationLogoPath } from "../integrations/logo.js";
import type {
  LinkedAccountCallbackNotice,
  LinkedAccountCardViewModel,
} from "../settings/identity-linking/linked-accounts-model.js";
import { FormPageSection, FormPageStack } from "../shared/form-page.js";
import { SettingsImageField } from "../shared/settings-image-field.js";

export type ProfileSettingsPageViewProps = {
  displayName: string;
  email: string;
  imageUrl: string | null;
  linkedAccountActionPending: boolean;
  linkedAccountCallbackNotice: LinkedAccountCallbackNotice | null;
  linkedAccountCards: readonly LinkedAccountCardViewModel[];
  linkedAccountErrorMessage: string | null;
  linkedAccountsEmptyStateMessage: string | null;
  linkedAccountsLoading: boolean;
  linkedAccountsLoadErrorMessage: string | null;
  onDeleteProfileImage: () => Promise<void>;
  onLinkLinkedAccount: (providerFamily: string) => Promise<void>;
  onSaveChanges: (displayName: string) => Promise<void>;
  onDeleteLinkedAccountCommitSigningKey: (providerFamily: string) => Promise<void>;
  onUnlinkLinkedAccount: (providerFamily: string) => Promise<void>;
  onUpdateLinkedAccountPreferredEmail: (
    providerFamily: string,
    preferredEmail: string,
  ) => Promise<void>;
  onUploadLinkedAccountCommitSigningKey: (providerFamily: string, file: File) => Promise<void>;
  onUploadProfileImage: (file: File) => Promise<void>;
  profileImageBusy: boolean;
  profileImageErrorMessage: string | null;
  saving: boolean;
};

export function ProfileSettingsPageView(props: ProfileSettingsPageViewProps): React.JSX.Element {
  return (
    <FormPageStack>
      <FormPageSection>
        <div className="flex flex-col gap-4 p-4">
          <SettingsImageField
            alt={`${props.displayName} profile image`}
            busy={props.profileImageBusy}
            errorMessage={props.profileImageErrorMessage}
            fallbackInitial="U"
            imageUrl={props.imageUrl}
            imageName="profile image"
            label="Avatar"
            name={props.displayName}
            onDelete={props.onDeleteProfileImage}
            onUpload={props.onUploadProfileImage}
          />
          <AutoSaveTextField
            disabled={props.saving}
            id="display-name"
            label="Display name"
            onSave={props.onSaveChanges}
            validate={() => null}
            value={props.displayName}
          />
          <Field contentWidth="fill" orientation="horizontal">
            <FieldHeader>
              <FieldLabel>Email</FieldLabel>
            </FieldHeader>
            <FieldContent>
              <Input disabled readOnly value={props.email} />
            </FieldContent>
          </Field>
        </div>
      </FormPageSection>
      {shouldRenderLinkedAccountsSection(props) ? (
        <FormPageSection>
          <div className="flex flex-col gap-4 p-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-semibold">Linked Accounts</h2>
              <p className="text-sm text-muted-foreground">
                Link external accounts so Mistle can attribute work to you.
              </p>
            </div>

            {props.linkedAccountCallbackNotice === null ? null : (
              <Notice
                title={props.linkedAccountCallbackNotice.title}
                variant={props.linkedAccountCallbackNotice.variant}
              >
                {props.linkedAccountCallbackNotice.message}
              </Notice>
            )}

            {props.linkedAccountsLoading ? (
              <div className="text-sm text-muted-foreground">Loading linked accounts…</div>
            ) : props.linkedAccountsLoadErrorMessage !== null ? (
              <Notice variant="alert">
                {props.linkedAccountsLoadErrorMessage} Please try again later.
              </Notice>
            ) : props.linkedAccountsEmptyStateMessage !== null ? (
              <Notice>{props.linkedAccountsEmptyStateMessage}</Notice>
            ) : props.linkedAccountCards.length === 0 ? null : (
              props.linkedAccountCards.map((linkedAccountCard) => (
                <LinkedAccountCard
                  key={linkedAccountCard.providerFamily}
                  linkedAccountActionPending={props.linkedAccountActionPending}
                  linkedAccountCard={linkedAccountCard}
                  onDeleteLinkedAccountCommitSigningKey={
                    props.onDeleteLinkedAccountCommitSigningKey
                  }
                  onLinkLinkedAccount={props.onLinkLinkedAccount}
                  onUnlinkLinkedAccount={props.onUnlinkLinkedAccount}
                  onUpdateLinkedAccountPreferredEmail={props.onUpdateLinkedAccountPreferredEmail}
                  onUploadLinkedAccountCommitSigningKey={
                    props.onUploadLinkedAccountCommitSigningKey
                  }
                />
              ))
            )}

            {props.linkedAccountErrorMessage === null ? null : (
              <Notice variant="alert">{props.linkedAccountErrorMessage}</Notice>
            )}
          </div>
        </FormPageSection>
      ) : null}
    </FormPageStack>
  );
}

function LinkedAccountCard(input: {
  linkedAccountActionPending: boolean;
  linkedAccountCard: LinkedAccountCardViewModel;
  onDeleteLinkedAccountCommitSigningKey: (providerFamily: string) => Promise<void>;
  onLinkLinkedAccount: (providerFamily: string) => Promise<void>;
  onUnlinkLinkedAccount: (providerFamily: string) => Promise<void>;
  onUpdateLinkedAccountPreferredEmail: (
    providerFamily: string,
    preferredEmail: string,
  ) => Promise<void>;
  onUploadLinkedAccountCommitSigningKey: (providerFamily: string, file: File) => Promise<void>;
}): React.JSX.Element {
  const emailPreference = input.linkedAccountCard.emailPreference;
  const commitSigning = input.linkedAccountCard.commitSigning;
  const commitSigningUploadInputRef = useRef<HTMLInputElement | null>(null);
  const [isCommitSigningDialogOpen, setIsCommitSigningDialogOpen] = useState(false);
  const [pastedCommitSigningKey, setPastedCommitSigningKey] = useState("");
  const [selectedEmail, setSelectedEmail] = useState(emailPreference?.selectedEmail ?? "");
  const selectedOptionLabel = emailPreference?.options.find(
    (option) => option.value === selectedEmail,
  )?.label;

  useEffect(() => {
    setSelectedEmail(emailPreference?.selectedEmail ?? "");
  }, [emailPreference?.selectedEmail, input.linkedAccountCard.providerFamily]);

  function closeCommitSigningDialog(): void {
    if (input.linkedAccountActionPending) {
      return;
    }

    setIsCommitSigningDialogOpen(false);
    setPastedCommitSigningKey("");
  }

  async function uploadCommitSigningKeyFile(file: File): Promise<void> {
    await input.onUploadLinkedAccountCommitSigningKey(input.linkedAccountCard.providerFamily, file);
    setIsCommitSigningDialogOpen(false);
    setPastedCommitSigningKey("");
  }

  async function handleCommitSigningDialogSubmit(
    event: SyntheticEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();

    const normalizedPrivateKey = pastedCommitSigningKey.trim();
    if (input.linkedAccountActionPending || normalizedPrivateKey.length === 0) {
      return;
    }

    try {
      await uploadCommitSigningKeyFile(
        new File([normalizedPrivateKey], "my-signing-key", {
          type: "text/plain",
        }),
      );
    } catch {}
  }

  return (
    <div className="rounded border bg-background p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <img
            alt={`${input.linkedAccountCard.displayName} logo`}
            className="h-10 w-10 rounded-md border bg-background p-1.5"
            src={resolveIntegrationLogoPath({ logoKey: input.linkedAccountCard.logoKey })}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">{input.linkedAccountCard.displayName}</h3>
              <LinkedAccountStatusBadge tone={input.linkedAccountCard.statusTone}>
                {input.linkedAccountCard.statusLabel}
              </LinkedAccountStatusBadge>
            </div>
            <p className="text-sm">{input.linkedAccountCard.accountLabel}</p>
            {input.linkedAccountCard.linkedAtLabel === null ? null : (
              <p className="text-xs text-muted-foreground">
                {input.linkedAccountCard.linkedAtLabel}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {input.linkedAccountCard.primaryActionLabel === null ? null : (
            <Button
              disabled={input.linkedAccountActionPending}
              onClick={() => {
                void input.onLinkLinkedAccount(input.linkedAccountCard.providerFamily);
              }}
              type="button"
            >
              {input.linkedAccountActionPending
                ? "Working..."
                : input.linkedAccountCard.primaryActionLabel}
            </Button>
          )}
          {input.linkedAccountCard.secondaryActionLabel === null ? null : (
            <Button
              disabled={input.linkedAccountActionPending}
              onClick={() => {
                void input.onUnlinkLinkedAccount(input.linkedAccountCard.providerFamily);
              }}
              type="button"
              variant="outline"
            >
              {input.linkedAccountActionPending
                ? "Working..."
                : input.linkedAccountCard.secondaryActionLabel}
            </Button>
          )}
        </div>
      </div>

      {emailPreference === null ? null : (
        <div className="mt-4">
          <Field contentWidth="fill" orientation="horizontal">
            <FieldHeader>
              <FieldLabel>Commit email</FieldLabel>
            </FieldHeader>
            <FieldContent>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Select
                  onValueChange={(nextValue) => {
                    setSelectedEmail(nextValue ?? "");
                  }}
                  value={selectedEmail}
                >
                  <SelectTrigger
                    className="w-full"
                    id={`linked-account-preferred-email-${input.linkedAccountCard.providerFamily}`}
                    style={{ width: "100%", maxWidth: "32rem" }}
                  >
                    <SelectValue placeholder="Select commit email">
                      {selectedOptionLabel}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {emailPreference.options.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  disabled={
                    input.linkedAccountActionPending ||
                    selectedEmail.length === 0 ||
                    selectedEmail === emailPreference.selectedEmail
                  }
                  onClick={() => {
                    void input.onUpdateLinkedAccountPreferredEmail(
                      input.linkedAccountCard.providerFamily,
                      selectedEmail,
                    );
                  }}
                  type="button"
                  variant="outline"
                >
                  {input.linkedAccountActionPending ? "Working..." : "Save"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{emailPreference.helperText}</p>
            </FieldContent>
          </Field>
        </div>
      )}

      {commitSigning === null ? null : (
        <div className="mt-4">
          <Field contentWidth="fill" orientation="horizontal">
            <FieldHeader>
              <FieldLabel>Commit signing</FieldLabel>
            </FieldHeader>
            <FieldContent>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm">{commitSigning.statusLabel}</p>
                  {commitSigning.keySummaryLabel === null ? null : (
                    <p className="truncate text-xs text-muted-foreground">
                      {commitSigning.keySummaryLabel}
                    </p>
                  )}
                  {commitSigning.helperLabel === null ? null : (
                    <p className="text-xs text-muted-foreground">{commitSigning.helperLabel}</p>
                  )}
                  {commitSigning.helperCommand === null ? null : (
                    <code className="mt-1 inline-block max-w-full overflow-x-auto rounded bg-muted px-2 py-1 font-mono text-xs select-all">
                      {commitSigning.helperCommand}
                    </code>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <input
                    aria-label={`Upload ${input.linkedAccountCard.displayName} commit signing private key`}
                    className="hidden"
                    ref={commitSigningUploadInputRef}
                    onChange={(event) => {
                      const selectedFile = event.currentTarget.files?.[0];
                      event.currentTarget.value = "";
                      if (selectedFile === null || selectedFile === undefined) {
                        return;
                      }

                      void input.onUploadLinkedAccountCommitSigningKey(
                        input.linkedAccountCard.providerFamily,
                        selectedFile,
                      );
                    }}
                    type="file"
                  />
                  <Button
                    disabled={input.linkedAccountActionPending}
                    onClick={() => {
                      setIsCommitSigningDialogOpen(true);
                    }}
                    type="button"
                    variant="outline"
                  >
                    {input.linkedAccountActionPending
                      ? "Working..."
                      : commitSigning.uploadActionLabel}
                  </Button>
                  {commitSigning.removeActionLabel === null ? null : (
                    <Button
                      disabled={input.linkedAccountActionPending}
                      onClick={() => {
                        void input.onDeleteLinkedAccountCommitSigningKey(
                          input.linkedAccountCard.providerFamily,
                        );
                      }}
                      type="button"
                      variant="outline"
                    >
                      {input.linkedAccountActionPending
                        ? "Working..."
                        : commitSigning.removeActionLabel}
                    </Button>
                  )}
                </div>
              </div>
            </FieldContent>
          </Field>
        </div>
      )}

      {input.linkedAccountCard.helperMessage === null ? null : (
        <p className="mt-3 text-sm text-muted-foreground">
          {input.linkedAccountCard.helperMessage}
        </p>
      )}

      {commitSigning === null ? null : (
        <Dialog
          isBusy={input.linkedAccountActionPending}
          isDismissible={!input.linkedAccountActionPending}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              closeCommitSigningDialog();
            }
          }}
          open={isCommitSigningDialogOpen}
        >
          {isCommitSigningDialogOpen ? (
            <DialogContent
              className="sm:max-w-2xl"
              formProps={{
                className: "grid gap-6",
                onSubmit: (event) => {
                  void handleCommitSigningDialogSubmit(event);
                },
              }}
            >
              <DialogHeader variant="sectioned">
                <DialogTitle>Upload SSH private key</DialogTitle>
              </DialogHeader>

              <div className="flex flex-col gap-3">
                <Textarea
                  className="field-sizing-fixed min-w-0 max-w-full font-mono text-xs"
                  onChange={(event) => {
                    setPastedCommitSigningKey(event.currentTarget.value);
                  }}
                  placeholder="Paste your SSH private key"
                  rows={12}
                  value={pastedCommitSigningKey}
                  wrap="soft"
                />
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-muted-foreground">Or choose a private key file</p>
                  <input
                    aria-label={`Choose ${input.linkedAccountCard.displayName} commit signing private key file`}
                    className="hidden"
                    ref={commitSigningUploadInputRef}
                    onChange={(event) => {
                      const selectedFile = event.currentTarget.files?.[0];
                      event.currentTarget.value = "";
                      if (selectedFile === null || selectedFile === undefined) {
                        return;
                      }

                      void uploadCommitSigningKeyFile(selectedFile).catch(() => undefined);
                    }}
                    type="file"
                  />
                  <Button
                    disabled={input.linkedAccountActionPending}
                    onClick={() => {
                      commitSigningUploadInputRef.current?.click();
                    }}
                    type="button"
                    variant="outline"
                  >
                    Choose file
                  </Button>
                </div>
              </div>

              <DialogFooter>
                <Button
                  disabled={input.linkedAccountActionPending}
                  onClick={closeCommitSigningDialog}
                  type="button"
                  variant="outline"
                >
                  Cancel
                </Button>
                <Button
                  disabled={
                    input.linkedAccountActionPending || pastedCommitSigningKey.trim().length === 0
                  }
                  type="submit"
                >
                  Upload private key
                </Button>
              </DialogFooter>
            </DialogContent>
          ) : null}
        </Dialog>
      )}
    </div>
  );
}

function shouldRenderLinkedAccountsSection(
  props: Pick<
    ProfileSettingsPageViewProps,
    | "linkedAccountCallbackNotice"
    | "linkedAccountCards"
    | "linkedAccountErrorMessage"
    | "linkedAccountsEmptyStateMessage"
    | "linkedAccountsLoading"
    | "linkedAccountsLoadErrorMessage"
  >,
): boolean {
  return (
    props.linkedAccountsLoading ||
    props.linkedAccountsLoadErrorMessage !== null ||
    props.linkedAccountsEmptyStateMessage !== null ||
    props.linkedAccountCards.length > 0 ||
    props.linkedAccountCallbackNotice !== null ||
    props.linkedAccountErrorMessage !== null
  );
}

function LinkedAccountStatusBadge(input: {
  children: React.ReactNode;
  tone: "active" | "warning" | "disabled";
}): React.JSX.Element {
  const className =
    input.tone === "active"
      ? "border-emerald-600/30 bg-emerald-600/10 text-emerald-700"
      : input.tone === "warning"
        ? "border-amber-600/30 bg-amber-600/10 text-amber-700"
        : "border-slate-600/20 bg-slate-600/5 text-slate-700";

  return (
    <Badge className={className} variant="outline">
      {input.children}
    </Badge>
  );
}
