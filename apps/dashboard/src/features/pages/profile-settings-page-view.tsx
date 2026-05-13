import {
  Badge,
  Button,
  CopyableValue,
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
  TextLink,
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
import type { CheckGitHubLinkedAccountSigningKeyResult } from "../settings/identity-linking/linked-accounts-service.js";
import { ActionTile } from "../shared/action-tile.js";
import { getErrorMessage } from "../shared/auto-save-behavior.js";
import { FormPageSection, FormPageStack } from "../shared/form-page.js";
import { InlineDividerLabel } from "../shared/inline-divider-label.js";
import { SettingsImageField } from "../shared/settings-image-field.js";

export type ProfileSettingsPageViewProps = {
  displayName: string;
  email: string;
  imageUrl: string | null;
  pendingLinkedAccountProviderFamilies: readonly string[];
  linkedAccountCallbackNotice: LinkedAccountCallbackNotice | null;
  linkedAccountCards: readonly LinkedAccountCardViewModel[];
  linkedAccountErrorMessage: string | null;
  linkedAccountsEmptyStateMessage: string | null;
  linkedAccountsLoading: boolean;
  linkedAccountsLoadErrorMessage: string | null;
  onDeleteProfileImage: () => Promise<void>;
  onLinkLinkedAccount: (providerFamily: string) => Promise<void>;
  onSaveChanges: (displayName: string) => Promise<void>;
  onCheckLinkedAccountCommitSigningKey: (
    providerFamily: string,
    file: File,
  ) => Promise<CheckGitHubLinkedAccountSigningKeyResult>;
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
  | "linkedAccountCallbackNotice"
  | "linkedAccountCards"
  | "linkedAccountErrorMessage"
  | "linkedAccountsEmptyStateMessage"
  | "linkedAccountsLoading"
  | "linkedAccountsLoadErrorMessage"
  | "onCheckLinkedAccountCommitSigningKey"
  | "onDeleteLinkedAccountCommitSigningKey"
  | "onLinkLinkedAccount"
  | "onUnlinkLinkedAccount"
  | "onUpdateLinkedAccountPreferredEmail"
  | "onUploadLinkedAccountCommitSigningKey"
  | "pendingLinkedAccountProviderFamilies"
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
              linkedAccountCard={linkedAccountCard}
              onCheckLinkedAccountCommitSigningKey={props.onCheckLinkedAccountCommitSigningKey}
              onDeleteLinkedAccountCommitSigningKey={props.onDeleteLinkedAccountCommitSigningKey}
              onLinkLinkedAccount={props.onLinkLinkedAccount}
              onUnlinkLinkedAccount={props.onUnlinkLinkedAccount}
              onUpdateLinkedAccountPreferredEmail={props.onUpdateLinkedAccountPreferredEmail}
              onUploadLinkedAccountCommitSigningKey={props.onUploadLinkedAccountCommitSigningKey}
              pendingLinkedAccountProviderFamilies={props.pendingLinkedAccountProviderFamilies}
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
  linkedAccountCard: LinkedAccountCardViewModel;
  onDeleteLinkedAccountCommitSigningKey: (providerFamily: string) => Promise<void>;
  onCheckLinkedAccountCommitSigningKey: (
    providerFamily: string,
    file: File,
  ) => Promise<CheckGitHubLinkedAccountSigningKeyResult>;
  onLinkLinkedAccount: (providerFamily: string) => Promise<void>;
  onUnlinkLinkedAccount: (providerFamily: string) => Promise<void>;
  onUpdateLinkedAccountPreferredEmail: (
    providerFamily: string,
    preferredEmail: string,
  ) => Promise<void>;
  onUploadLinkedAccountCommitSigningKey: (providerFamily: string, file: File) => Promise<void>;
  pendingLinkedAccountProviderFamilies: readonly string[];
}): React.JSX.Element {
  const emailPreference = input.linkedAccountCard.emailPreference;
  const commitSigning = input.linkedAccountCard.commitSigning;
  const linkedAccountActionPending = input.pendingLinkedAccountProviderFamilies.includes(
    input.linkedAccountCard.providerFamily,
  );
  const commitSigningUploadInputRef = useRef<HTMLInputElement | null>(null);
  const [isCommitSigningDialogOpen, setIsCommitSigningDialogOpen] = useState(false);
  const [pastedCommitSigningKey, setPastedCommitSigningKey] = useState("");
  const [selectedCommitSigningKeyFile, setSelectedCommitSigningKeyFile] = useState<File | null>(
    null,
  );
  const [showCommitSigningLocalGenerationHelp, setShowCommitSigningLocalGenerationHelp] =
    useState(false);
  const [commitSigningDialogErrorMessage, setCommitSigningDialogErrorMessage] = useState<
    string | null
  >(null);
  const [checkedCommitSigningKey, setCheckedCommitSigningKey] =
    useState<CommitSigningKeyCheckedDraft | null>(null);

  function closeCommitSigningDialog(): void {
    if (linkedAccountActionPending) {
      return;
    }

    setIsCommitSigningDialogOpen(false);
    setPastedCommitSigningKey("");
    setSelectedCommitSigningKeyFile(null);
    setShowCommitSigningLocalGenerationHelp(false);
    setCommitSigningDialogErrorMessage(null);
    setCheckedCommitSigningKey(null);
  }

  function openCommitSigningDialog(): void {
    setCommitSigningDialogErrorMessage(null);
    setCheckedCommitSigningKey(null);
    setShowCommitSigningLocalGenerationHelp(false);
    setIsCommitSigningDialogOpen(true);
  }

  async function checkCommitSigningKey(draft: CommitSigningKeyDraft): Promise<void> {
    try {
      const result = await input.onCheckLinkedAccountCommitSigningKey(
        input.linkedAccountCard.providerFamily,
        draft.file,
      );
      setCheckedCommitSigningKey({
        ...toCheckedCommitSigningKeyDraft(draft),
        result,
      });
      setCommitSigningDialogErrorMessage(null);
    } catch (error) {
      setCheckedCommitSigningKey(null);
      setCommitSigningDialogErrorMessage(getErrorMessage(error));
    }
  }

  async function uploadCommitSigningKey(draft: CommitSigningKeyDraft): Promise<void> {
    try {
      await input.onUploadLinkedAccountCommitSigningKey(
        input.linkedAccountCard.providerFamily,
        draft.file,
      );
      setIsCommitSigningDialogOpen(false);
      setPastedCommitSigningKey("");
      setSelectedCommitSigningKeyFile(null);
      setCheckedCommitSigningKey(null);
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
    const draft = resolveCommitSigningKeyDraft({
      normalizedPrivateKey,
      selectedFile: selectedCommitSigningKeyFile,
    });
    if (linkedAccountActionPending || draft === null) {
      return;
    }

    if (!isCheckedCommitSigningKeyDraftCurrent({ checked: checkedCommitSigningKey, draft })) {
      return;
    }

    await uploadCommitSigningKey(draft);
  }

  const normalizedCommitSigningPrivateKey = pastedCommitSigningKey.trim();
  const commitSigningKeyDraft = resolveCommitSigningKeyDraft({
    normalizedPrivateKey: normalizedCommitSigningPrivateKey,
    selectedFile: selectedCommitSigningKeyFile,
  });
  const canCheckCommitSigningKey = commitSigningKeyDraft !== null;
  const canSaveCheckedCommitSigningKey =
    commitSigningKeyDraft !== null &&
    isCheckedCommitSigningKeyDraftCurrent({
      checked: checkedCommitSigningKey,
      draft: commitSigningKeyDraft,
    });

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
              disabled={linkedAccountActionPending}
              onClick={() => {
                void input.onLinkLinkedAccount(input.linkedAccountCard.providerFamily);
              }}
              type="button"
            >
              {linkedAccountActionPending ? (
                <Spinner aria-hidden className="size-4" />
              ) : (
                input.linkedAccountCard.primaryActionLabel
              )}
            </Button>
          )}
          {input.linkedAccountCard.secondaryActionLabel === null ? null : (
            <Button
              aria-label={input.linkedAccountCard.secondaryActionLabel}
              disabled={linkedAccountActionPending}
              onClick={() => {
                void input.onUnlinkLinkedAccount(input.linkedAccountCard.providerFamily);
              }}
              type="button"
              variant="outline"
            >
              {linkedAccountActionPending ? (
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
            disabled={linkedAccountActionPending}
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
                  {commitSigning.removeActionLabel === null &&
                  commitSigning.keySummaryLabel === null ? (
                    <Button
                      disabled={linkedAccountActionPending}
                      onClick={() => {
                        openCommitSigningDialog();
                      }}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      {linkedAccountActionPending ? (
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
                        disabled={linkedAccountActionPending}
                        onClick={() => {
                          openCommitSigningDialog();
                        }}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        {linkedAccountActionPending ? (
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
                      disabled={linkedAccountActionPending}
                      onClick={() => {
                        void input.onDeleteLinkedAccountCommitSigningKey(
                          input.linkedAccountCard.providerFamily,
                        );
                      }}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      {linkedAccountActionPending ? (
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
          isBusy={linkedAccountActionPending}
          isDismissible={!linkedAccountActionPending}
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
                className: "grid gap-5",
                onSubmit: (event) => {
                  void handleCommitSigningDialogSubmit(event);
                },
              }}
            >
              <DialogHeader variant="sectioned">
                <DialogTitle>Add Private Key</DialogTitle>
              </DialogHeader>

              <div className="flex flex-col gap-5">
                {showCommitSigningLocalGenerationHelp ? (
                  <div className="flex flex-col gap-3">
                    <CopyableValue
                      label="Generate a SSH signing key with no passphrase"
                      value='ssh-keygen -t ed25519 -N "" -f ~/.ssh/mistle-signing'
                    />
                    <CopyableValue
                      label="Add the public key via GitHub settings or via GH CLI:"
                      labelContent={
                        <>
                          Add the public key via{" "}
                          <TextLink href="https://github.com/settings/keys" opensInNewWindow>
                            GitHub settings
                          </TextLink>{" "}
                          or via GH CLI:
                        </>
                      }
                      value="gh ssh-key add ~/.ssh/mistle-signing.pub --type signing"
                    />
                  </div>
                ) : (
                  <ActionTile
                    action={
                      <Button
                        disabled={linkedAccountActionPending}
                        onClick={() => {
                          setShowCommitSigningLocalGenerationHelp(true);
                        }}
                        type="button"
                        variant="outline"
                      >
                        Show helper
                      </Button>
                    }
                    description="Generate one on your machine, then upload the private key here."
                    title="Need a new signing key?"
                  />
                )}
                <Textarea
                  className="field-sizing-fixed min-w-0 max-w-full text-sm"
                  onChange={(event) => {
                    setCommitSigningDialogErrorMessage(null);
                    setCheckedCommitSigningKey(null);
                    setSelectedCommitSigningKeyFile(null);
                    setPastedCommitSigningKey(event.currentTarget.value);
                  }}
                  placeholder="Paste your SSH private key"
                  rows={6}
                  value={pastedCommitSigningKey}
                  wrap="soft"
                />
                {commitSigningDialogErrorMessage === null ? null : (
                  <Notice variant="alert">{commitSigningDialogErrorMessage}</Notice>
                )}
                {selectedCommitSigningKeyFile === null ? null : (
                  <Notice>Selected file: {selectedCommitSigningKeyFile.name}</Notice>
                )}
                <CommitSigningKeyCheckNotice checkedCommitSigningKey={checkedCommitSigningKey} />
                <div className="flex flex-col gap-4">
                  <InlineDividerLabel label="Or" />
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

                      setPastedCommitSigningKey("");
                      setSelectedCommitSigningKeyFile(selectedFile);
                      setCheckedCommitSigningKey(null);
                      setCommitSigningDialogErrorMessage(null);
                    }}
                    type="file"
                  />
                  <Button
                    disabled={linkedAccountActionPending}
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
                  disabled={linkedAccountActionPending}
                  onClick={closeCommitSigningDialog}
                  type="button"
                  variant="outline"
                >
                  Cancel
                </Button>
                <Button
                  disabled={linkedAccountActionPending || !canCheckCommitSigningKey}
                  onClick={() => {
                    if (commitSigningKeyDraft !== null) {
                      void checkCommitSigningKey(commitSigningKeyDraft);
                    }
                  }}
                  type="button"
                  variant="outline"
                >
                  {linkedAccountActionPending ? (
                    <Spinner aria-hidden className="size-4" />
                  ) : (
                    "Check key"
                  )}
                </Button>
                <Button
                  disabled={linkedAccountActionPending || !canSaveCheckedCommitSigningKey}
                  type="submit"
                >
                  Add private key
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

type CommitSigningKeyDraft =
  | {
      kind: "text";
      normalizedPrivateKey: string;
      file: File;
    }
  | {
      kind: "file";
      selectedFile: File;
      file: File;
    };

type CommitSigningKeyCheckedDraft =
  | {
      kind: "text";
      normalizedPrivateKey: string;
      result: CheckGitHubLinkedAccountSigningKeyResult;
    }
  | {
      kind: "file";
      selectedFile: File;
      result: CheckGitHubLinkedAccountSigningKeyResult;
    };

type CommitSigningKeyCheckedDraftIdentity =
  | {
      kind: "text";
      normalizedPrivateKey: string;
    }
  | {
      kind: "file";
      selectedFile: File;
    };

function resolveCommitSigningKeyDraft(input: {
  normalizedPrivateKey: string;
  selectedFile: File | null;
}): CommitSigningKeyDraft | null {
  if (input.selectedFile !== null) {
    return {
      kind: "file",
      selectedFile: input.selectedFile,
      file: input.selectedFile,
    };
  }

  if (input.normalizedPrivateKey.length === 0) {
    return null;
  }

  return {
    kind: "text",
    normalizedPrivateKey: input.normalizedPrivateKey,
    file: new File([input.normalizedPrivateKey], "my-signing-key", {
      type: "text/plain",
    }),
  };
}

function toCheckedCommitSigningKeyDraft(
  draft: CommitSigningKeyDraft,
): CommitSigningKeyCheckedDraftIdentity {
  if (draft.kind === "file") {
    return {
      kind: "file",
      selectedFile: draft.selectedFile,
    };
  }

  return {
    kind: "text",
    normalizedPrivateKey: draft.normalizedPrivateKey,
  };
}

function isCheckedCommitSigningKeyDraftCurrent(input: {
  checked: CommitSigningKeyCheckedDraft | null;
  draft: CommitSigningKeyDraft;
}): boolean {
  if (input.checked === null || input.checked.result.status !== "registered") {
    return false;
  }

  if (input.checked.kind !== input.draft.kind) {
    return false;
  }

  if (input.checked.kind === "file") {
    return input.draft.kind === "file" && input.checked.selectedFile === input.draft.selectedFile;
  }

  return (
    input.draft.kind === "text" &&
    input.checked.normalizedPrivateKey === input.draft.normalizedPrivateKey
  );
}

function CommitSigningKeyCheckNotice(input: {
  checkedCommitSigningKey: CommitSigningKeyCheckedDraft | null;
}): React.JSX.Element | null {
  if (input.checkedCommitSigningKey === null) {
    return null;
  }

  if (input.checkedCommitSigningKey.result.status === "registered") {
    return (
      <Notice variant="success">
        This private key can sign commits and matches a GitHub SSH signing key.
      </Notice>
    );
  }

  return (
    <Notice variant="warning">
      This private key can sign commits, but its public key is not registered as a GitHub signing
      key.
    </Notice>
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
