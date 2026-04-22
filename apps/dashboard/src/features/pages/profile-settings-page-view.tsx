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
  Spinner,
  Textarea,
} from "@mistle/ui";
import { PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react";
import type { SyntheticEvent } from "react";
import { useRef, useState } from "react";

import { AutoSaveSelectField } from "../forms/auto-save-select-field.js";
import { AutoSaveTextField } from "../forms/auto-save-text-field.js";
import { resolveIntegrationLogoPath } from "../integrations/logo.js";
import type {
  LinkedAccountCallbackNotice,
  LinkedAccountCardViewModel,
} from "../settings/identity-linking/linked-accounts-model.js";
import { getErrorMessage } from "../shared/auto-save-behavior.js";
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

export type ProfileSettingsUserSectionProps = Pick<
  ProfileSettingsPageViewProps,
  | "displayName"
  | "email"
  | "imageUrl"
  | "onDeleteProfileImage"
  | "onSaveChanges"
  | "onUploadProfileImage"
  | "profileImageBusy"
  | "profileImageErrorMessage"
  | "saving"
>;

export type ProfileSettingsLinkedAccountsSectionProps = Pick<
  ProfileSettingsPageViewProps,
  | "linkedAccountActionPending"
  | "linkedAccountCallbackNotice"
  | "linkedAccountCards"
  | "linkedAccountErrorMessage"
  | "linkedAccountsEmptyStateMessage"
  | "linkedAccountsLoading"
  | "linkedAccountsLoadErrorMessage"
  | "onDeleteLinkedAccountCommitSigningKey"
  | "onLinkLinkedAccount"
  | "onUnlinkLinkedAccount"
  | "onUpdateLinkedAccountPreferredEmail"
  | "onUploadLinkedAccountCommitSigningKey"
>;

export function ProfileSettingsPageView(props: ProfileSettingsPageViewProps): React.JSX.Element {
  return (
    <FormPageStack>
      <ProfileSettingsUserSection {...props} />
      {shouldRenderLinkedAccountsSection(props) ? (
        <ProfileSettingsLinkedAccountsSection {...props} />
      ) : null}
    </FormPageStack>
  );
}

export function ProfileSettingsUserSection(
  props: ProfileSettingsUserSectionProps,
): React.JSX.Element {
  return (
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
  );
}

export function ProfileSettingsLinkedAccountsSection(
  props: ProfileSettingsLinkedAccountsSectionProps,
): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">Linked Accounts</h2>
        <p className="text-sm text-muted-foreground">
          Link accounts to enable Mistle to attribute actions it takes on your behalf to you.
        </p>
      </div>

      <LinkedAccountsFeedbackStack
        linkedAccountCallbackNotice={props.linkedAccountCallbackNotice}
        linkedAccountErrorMessage={props.linkedAccountErrorMessage}
        linkedAccountsEmptyStateMessage={props.linkedAccountsEmptyStateMessage}
        linkedAccountsLoading={props.linkedAccountsLoading}
        linkedAccountsLoadErrorMessage={props.linkedAccountsLoadErrorMessage}
      />

      {props.linkedAccountsLoading ||
      props.linkedAccountsLoadErrorMessage !== null ||
      props.linkedAccountsEmptyStateMessage !== null ||
      props.linkedAccountCards.length === 0
        ? null
        : props.linkedAccountCards.map((linkedAccountCard) => (
            <LinkedAccountCard
              key={linkedAccountCard.providerFamily}
              linkedAccountActionPending={props.linkedAccountActionPending}
              linkedAccountCard={linkedAccountCard}
              onDeleteLinkedAccountCommitSigningKey={props.onDeleteLinkedAccountCommitSigningKey}
              onLinkLinkedAccount={props.onLinkLinkedAccount}
              onUnlinkLinkedAccount={props.onUnlinkLinkedAccount}
              onUpdateLinkedAccountPreferredEmail={props.onUpdateLinkedAccountPreferredEmail}
              onUploadLinkedAccountCommitSigningKey={props.onUploadLinkedAccountCommitSigningKey}
            />
          ))}
    </div>
  );
}

function LinkedAccountsFeedbackStack(
  props: Pick<
    ProfileSettingsLinkedAccountsSectionProps,
    | "linkedAccountCallbackNotice"
    | "linkedAccountErrorMessage"
    | "linkedAccountsEmptyStateMessage"
    | "linkedAccountsLoading"
    | "linkedAccountsLoadErrorMessage"
  >,
): React.JSX.Element | null {
  const hasFeedback =
    props.linkedAccountCallbackNotice !== null ||
    props.linkedAccountsLoading ||
    props.linkedAccountsLoadErrorMessage !== null ||
    props.linkedAccountsEmptyStateMessage !== null ||
    props.linkedAccountErrorMessage !== null;

  if (!hasFeedback) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
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
      ) : null}

      {props.linkedAccountErrorMessage === null ? null : (
        <Notice variant="alert">{props.linkedAccountErrorMessage}</Notice>
      )}
    </div>
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
  const [commitSigningDialogErrorMessage, setCommitSigningDialogErrorMessage] = useState<
    string | null
  >(null);

  function closeCommitSigningDialog(): void {
    if (input.linkedAccountActionPending) {
      return;
    }

    setIsCommitSigningDialogOpen(false);
    setPastedCommitSigningKey("");
    setCommitSigningDialogErrorMessage(null);
  }

  function openCommitSigningDialog(): void {
    setCommitSigningDialogErrorMessage(null);
    setIsCommitSigningDialogOpen(true);
  }

  async function uploadCommitSigningKeyFile(file: File): Promise<void> {
    try {
      await input.onUploadLinkedAccountCommitSigningKey(
        input.linkedAccountCard.providerFamily,
        file,
      );
      setIsCommitSigningDialogOpen(false);
      setPastedCommitSigningKey("");
      setCommitSigningDialogErrorMessage(null);
    } catch (error) {
      setCommitSigningDialogErrorMessage(getErrorMessage(error));
    }
  }

  async function handleCommitSigningDialogSubmit(
    event: SyntheticEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();

    const normalizedPrivateKey = pastedCommitSigningKey.trim();
    if (input.linkedAccountActionPending || normalizedPrivateKey.length === 0) {
      return;
    }

    await uploadCommitSigningKeyFile(
      new File([normalizedPrivateKey], "my-signing-key", {
        type: "text/plain",
      }),
    );
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
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {input.linkedAccountCard.primaryActionLabel === null ? null : (
            <Button
              aria-label={input.linkedAccountCard.primaryActionLabel}
              disabled={input.linkedAccountActionPending}
              onClick={() => {
                void input.onLinkLinkedAccount(input.linkedAccountCard.providerFamily);
              }}
              type="button"
            >
              {input.linkedAccountActionPending ? (
                <Spinner aria-hidden className="size-4" />
              ) : (
                input.linkedAccountCard.primaryActionLabel
              )}
            </Button>
          )}
          {input.linkedAccountCard.secondaryActionLabel === null ? null : (
            <Button
              aria-label={input.linkedAccountCard.secondaryActionLabel}
              disabled={input.linkedAccountActionPending}
              onClick={() => {
                void input.onUnlinkLinkedAccount(input.linkedAccountCard.providerFamily);
              }}
              type="button"
              variant="outline"
            >
              {input.linkedAccountActionPending ? (
                <Spinner aria-hidden className="size-4" />
              ) : (
                input.linkedAccountCard.secondaryActionLabel
              )}
            </Button>
          )}
        </div>
      </div>

      {emailPreference === null ? null : (
        <div className="mt-4">
          <AutoSaveSelectField
            disabled={input.linkedAccountActionPending}
            id={`linked-account-preferred-email-${input.linkedAccountCard.providerFamily}`}
            label="Commit email"
            noneLabel="None"
            onSave={async (nextValue) => {
              await input.onUpdateLinkedAccountPreferredEmail(
                input.linkedAccountCard.providerFamily,
                nextValue,
              );
            }}
            options={emailPreference.options}
            showErrorMessage={false}
            value={emailPreference.selectedEmail}
          />
        </div>
      )}

      {commitSigning === null ? null : (
        <div className="mt-4">
          <Field contentWidth="fill" orientation="horizontal">
            <FieldHeader>
              <FieldLabel>Commit signing</FieldLabel>
            </FieldHeader>
            <FieldContent>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-4">
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

                      void uploadCommitSigningKeyFile(selectedFile);
                    }}
                    type="file"
                  />
                  {commitSigning.removeActionLabel === null &&
                  commitSigning.keySummaryLabel === null ? (
                    <Button
                      disabled={input.linkedAccountActionPending}
                      onClick={() => {
                        openCommitSigningDialog();
                      }}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      {input.linkedAccountActionPending ? (
                        <Spinner aria-hidden className="size-4" />
                      ) : (
                        <>
                          <span>{commitSigning.statusLabel}</span>
                          <PencilSimpleIcon aria-hidden className="size-4" />
                        </>
                      )}
                    </Button>
                  ) : (
                    <>
                      <div className="min-w-0 text-left sm:text-right">
                        <p className="text-sm">{commitSigning.statusLabel}</p>
                        {commitSigning.keySummaryLabel === null ? null : (
                          <p className="truncate text-xs text-muted-foreground">
                            {commitSigning.keySummaryLabel}
                          </p>
                        )}
                      </div>
                      <Button
                        aria-label={commitSigning.uploadActionLabel}
                        disabled={input.linkedAccountActionPending}
                        onClick={() => {
                          openCommitSigningDialog();
                        }}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        {input.linkedAccountActionPending ? (
                          <Spinner aria-hidden className="size-4" />
                        ) : (
                          <PencilSimpleIcon aria-hidden className="size-4" />
                        )}
                      </Button>
                    </>
                  )}
                  {commitSigning.removeActionLabel === null ? null : (
                    <Button
                      aria-label={commitSigning.removeActionLabel}
                      disabled={input.linkedAccountActionPending}
                      onClick={() => {
                        void input.onDeleteLinkedAccountCommitSigningKey(
                          input.linkedAccountCard.providerFamily,
                        );
                      }}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      {input.linkedAccountActionPending ? (
                        <Spinner aria-hidden className="size-4" />
                      ) : (
                        <TrashIcon aria-hidden className="size-4" />
                      )}
                    </Button>
                  )}
                </div>
              </div>
            </FieldContent>
          </Field>
        </div>
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
                    setCommitSigningDialogErrorMessage(null);
                    setPastedCommitSigningKey(event.currentTarget.value);
                  }}
                  placeholder="Paste your SSH private key"
                  rows={12}
                  value={pastedCommitSigningKey}
                  wrap="soft"
                />
                {commitSigningDialogErrorMessage === null ? null : (
                  <Notice variant="alert">{commitSigningDialogErrorMessage}</Notice>
                )}
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

                      setCommitSigningDialogErrorMessage(null);
                      void uploadCommitSigningKeyFile(selectedFile);
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

      {input.linkedAccountCard.helperMessage === null ? null : (
        <p className="mt-3 text-sm text-muted-foreground">
          {input.linkedAccountCard.helperMessage}
        </p>
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
