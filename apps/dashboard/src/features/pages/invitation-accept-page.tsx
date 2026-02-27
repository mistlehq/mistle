import { Button, Card, CardContent, Spinner } from "@mistle/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { MistleLogo } from "../../components/mistle-logo.js";
import { authClient } from "../../lib/auth/client.js";
import { AuthPageShell, AuthPageWidths } from "../auth/auth-page-shell.js";
import { EmailStage } from "../auth/email-stage.js";
import { resolveErrorMessage } from "../auth/messages.js";
import { OtpStage } from "../auth/otp-stage.js";
import { SESSION_QUERY_KEY, useSessionQuery } from "../shell/session-query.js";
import {
  acceptInvitationAndSetActiveOrganization,
  fetchInvitation,
  rejectInvitation,
} from "./invitation-accept-service.js";
import {
  formatInvitationRole,
  isInvitationFetchDifferentAccountError,
  toInvitationFetchErrorMessage,
  toInvitationMutationErrorMessage,
} from "./invitation-accept-state.js";
import { InvitationStateCard } from "./invitation-state-card.js";
import { useInvitationAuth } from "./use-invitation-auth.js";

type InviteDecision = "idle" | "accepted" | "rejected";

export function InvitationAcceptPage(): React.JSX.Element {
  const [searchParams] = useSearchParams();
  const invitationId = searchParams.get("invitationId");
  const invitedEmailFromLink = searchParams.get("email");
  const organizationNameFromLink = searchParams.get("organizationName");
  const inviterEmailFromLink = searchParams.get("invitedBy");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sessionQuery = useSessionQuery();
  const [decision, setDecision] = useState<InviteDecision>("idle");
  const [mutationError, setMutationError] = useState<string | null>(null);
  const invitationAuth = useInvitationAuth({
    initialEmail: invitedEmailFromLink === null ? "" : invitedEmailFromLink,
  });
  const {
    authError,
    authStep,
    email,
    handleSendOtp,
    handleVerifyOtp,
    isSendingOtp,
    isVerifyingOtp,
    otp,
    setEmail,
    setOtp,
  } = invitationAuth;
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const normalizedInvitedEmailFromLink = invitedEmailFromLink?.trim().toLowerCase() ?? null;
  const normalizedSessionEmail = sessionQuery.data?.user.email?.trim().toLowerCase() ?? null;
  const isWrongAccountFromInviteLink =
    normalizedInvitedEmailFromLink !== null &&
    normalizedInvitedEmailFromLink.length > 0 &&
    normalizedSessionEmail !== null &&
    normalizedSessionEmail !== normalizedInvitedEmailFromLink;
  const invitationQuery = useQuery({
    queryKey: ["auth", "invitation", invitationId],
    enabled:
      invitationId !== null &&
      !sessionQuery.isPending &&
      !sessionQuery.isError &&
      sessionQuery.data !== null &&
      !isWrongAccountFromInviteLink,
    retry: false,
    queryFn: async () => fetchInvitation(invitationId ?? ""),
  });

  const acceptMutation = useMutation({
    mutationFn: async () => {
      if (invitationId === null) {
        throw new Error("Missing invitation ID.");
      }
      const organizationId = invitationQuery.data?.organizationId;
      if (organizationId === undefined) {
        throw new Error("Invitation details are unavailable.");
      }

      await acceptInvitationAndSetActiveOrganization({
        invitationId,
        organizationId,
      });
    },
    onSuccess: async () => {
      setMutationError(null);
      setDecision("accepted");
      await queryClient.invalidateQueries({
        queryKey: SESSION_QUERY_KEY,
      });
    },
    onError: (error: unknown) => {
      setMutationError(toInvitationMutationErrorMessage(error, "accept"));
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async () => {
      if (invitationId === null) {
        throw new Error("Missing invitation ID.");
      }
      await rejectInvitation({ invitationId });
    },
    onSuccess: () => {
      setMutationError(null);
      setDecision("rejected");
    },
    onError: (error: unknown) => {
      setMutationError(toInvitationMutationErrorMessage(error, "reject"));
    },
  });

  const isSubmitting = acceptMutation.isPending || rejectMutation.isPending;

  const invitationErrorMessage = useMemo(() => {
    if (!invitationQuery.isError) {
      return null;
    }
    return toInvitationFetchErrorMessage(invitationQuery.error);
  }, [invitationQuery.error, invitationQuery.isError]);
  const canSignOutForDifferentAccount =
    invitationQuery.isError &&
    sessionQuery.data !== null &&
    isInvitationFetchDifferentAccountError(invitationQuery.error);

  async function handleSignOutAndUseDifferentAccount(): Promise<void> {
    setSignOutError(null);
    const response = await authClient.signOut();
    if (response.error) {
      setSignOutError(resolveErrorMessage(response.error, "Unable to sign out."));
      return;
    }

    await queryClient.invalidateQueries({
      queryKey: SESSION_QUERY_KEY,
    });
  }

  if (invitationId === null || invitationId.length === 0) {
    return (
      <InvitationStateCard
        description="Invitation ID is missing."
        maxWidthClass={AuthPageWidths.LG}
        title="You've been invited to join Mistle"
        actions={
          <Button onClick={() => void navigate("/", { replace: true })} type="button">
            Go to dashboard
          </Button>
        }
      />
    );
  }

  if (sessionQuery.isPending) {
    return (
      <InvitationStateCard
        description="Checking your session."
        maxWidthClass={AuthPageWidths.LG}
        title="You've been invited to join Mistle"
      >
        <div className="text-muted-foreground gap-2 flex items-center">
          <Spinner />
          Loading...
        </div>
      </InvitationStateCard>
    );
  }

  if (sessionQuery.isError) {
    return (
      <InvitationStateCard
        description="Session check failed."
        maxWidthClass={AuthPageWidths.LG}
        title="You've been invited to join Mistle"
      >
        <p className="text-destructive text-sm">{sessionQuery.error.message}</p>
      </InvitationStateCard>
    );
  }

  if (sessionQuery.data === null) {
    return (
      <AuthPageShell
        maxWidthClass={authStep === "otp" ? AuthPageWidths.SM : AuthPageWidths.LG}
        title={authStep === "email" ? "You've been invited to join Mistle" : null}
      >
        {authStep === "email" ? (
          <EmailStage
            authError={authError}
            beforeForm={
              <>
                <Card className="w-full">
                  <CardContent className="gap-4 grid">
                    {organizationNameFromLink === null ||
                    organizationNameFromLink.length === 0 ? null : (
                      <p className="text-sm">
                        <span className="text-muted-foreground">Organization:</span>{" "}
                        <span className="font-medium">{organizationNameFromLink}</span>
                      </p>
                    )}
                    {inviterEmailFromLink === null || inviterEmailFromLink.length === 0 ? null : (
                      <p className="text-sm">
                        <span className="text-muted-foreground">Invited by:</span>{" "}
                        <span className="font-medium">{inviterEmailFromLink}</span>
                      </p>
                    )}
                  </CardContent>
                </Card>
                <p className="text-sm text-center mt-2">
                  <span className="text-muted-foreground">Sign in as </span>
                  <span className="font-medium">{email}</span>
                  <span className="text-muted-foreground"> to accept this invitation.</span>
                </p>
              </>
            }
            email={email}
            footerError={null}
            isEmailEditable={false}
            isEmailHidden={true}
            isSendingOtp={isSendingOtp}
            onEmailChange={setEmail}
            onSubmit={handleSendOtp}
          />
        ) : (
          <OtpStage
            authError={authError}
            email={email}
            footerError={null}
            isVerifyingOtp={isVerifyingOtp}
            onOtpChange={setOtp}
            onSubmit={handleVerifyOtp}
            otp={otp}
          />
        )}
      </AuthPageShell>
    );
  }

  if (isWrongAccountFromInviteLink) {
    return (
      <InvitationStateCard
        description="This invitation cannot be opened."
        maxWidthClass={AuthPageWidths.LG}
        title="You've been invited to join Mistle"
        actions={
          <>
            <Button
              onClick={() => {
                void handleSignOutAndUseDifferentAccount();
              }}
              type="button"
              variant="secondary"
            >
              Sign out and use a different account
            </Button>
            <Button
              onClick={() => void navigate("/", { replace: true })}
              type="button"
              variant="outline"
            >
              Go to dashboard
            </Button>
          </>
        }
      >
        <p className="text-destructive text-sm">This invitation belongs to a different account.</p>
        {signOutError === null ? null : <p className="text-destructive text-sm">{signOutError}</p>}
      </InvitationStateCard>
    );
  }

  if (invitationQuery.isError) {
    return (
      <InvitationStateCard
        description="This invitation cannot be opened."
        maxWidthClass={AuthPageWidths.LG}
        title="You've been invited to join Mistle"
        actions={
          <>
            {canSignOutForDifferentAccount ? (
              <Button
                onClick={() => {
                  void handleSignOutAndUseDifferentAccount();
                }}
                type="button"
                variant="secondary"
              >
                Sign out and use a different account
              </Button>
            ) : null}
            <Button
              onClick={() => void navigate("/", { replace: true })}
              type="button"
              variant="outline"
            >
              Go to dashboard
            </Button>
          </>
        }
      >
        <p className="text-destructive text-sm">{invitationErrorMessage}</p>
        {signOutError === null ? null : <p className="text-destructive text-sm">{signOutError}</p>}
      </InvitationStateCard>
    );
  }

  if (invitationQuery.isPending || invitationQuery.data === undefined) {
    return (
      <InvitationStateCard
        description="Loading invitation details."
        maxWidthClass={AuthPageWidths.LG}
        title="You've been invited to join Mistle"
      >
        <div className="text-muted-foreground gap-2 flex items-center">
          <Spinner />
          Loading...
        </div>
      </InvitationStateCard>
    );
  }

  const invitation = invitationQuery.data;
  const invitationOrganizationName =
    invitation.organizationName ?? organizationNameFromLink ?? "this organization";
  const invitationInviterDisplay =
    invitation.inviterEmail ?? inviterEmailFromLink ?? invitation.inviterId;

  if (decision === "accepted") {
    return (
      <InvitationStateCard
        description={`You now have access to ${invitationOrganizationName}.`}
        maxWidthClass={AuthPageWidths.LG}
        title="Invitation accepted"
        actions={
          <Button onClick={() => void navigate("/", { replace: true })} type="button">
            Go to dashboard
          </Button>
        }
      />
    );
  }

  if (decision === "rejected") {
    return (
      <InvitationStateCard
        description="You declined this invitation."
        maxWidthClass={AuthPageWidths.XL}
        title="Invitation declined"
        actions={
          <Button
            onClick={() => void navigate("/", { replace: true })}
            type="button"
            variant="outline"
          >
            Go to dashboard
          </Button>
        }
      />
    );
  }

  return (
    <main className="from-background to-muted/20 min-h-svh bg-linear-to-b">
      <div className="mx-auto flex min-h-svh w-full max-w-lg items-center px-4 py-8">
        <div className="w-full gap-4 flex flex-col">
          <MistleLogo className="mx-auto" mode="with-text" />
          <h1 className="text-center text-lg font-medium">
            You&apos;ve been invited to join Mistle
          </h1>
          <Card className="w-full">
            <CardContent className="gap-4 grid">
              <dl className="gap-3 grid">
                <div>
                  <dt className="text-muted-foreground text-xs">Organization</dt>
                  <dd className="text-sm font-medium">{invitationOrganizationName}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Role</dt>
                  <dd className="text-sm">{formatInvitationRole(invitation.role)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Invited email</dt>
                  <dd className="text-sm">{invitation.email}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Invited by</dt>
                  <dd className="text-sm">{invitationInviterDisplay}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
          {mutationError === null ? null : (
            <p className="text-destructive text-sm">{mutationError}</p>
          )}
          <div className="gap-4 flex flex-col">
            <Button
              className="h-12 w-full text-sm"
              disabled={isSubmitting}
              onClick={() => {
                setMutationError(null);
                acceptMutation.mutate();
              }}
              size="lg"
              type="button"
            >
              {acceptMutation.isPending ? "Accepting..." : "Accept invitation"}
            </Button>
            <Button
              className="h-12 w-full text-sm text-zinc-500 hover:text-zinc-700"
              disabled={isSubmitting}
              onClick={() => {
                setMutationError(null);
                rejectMutation.mutate();
              }}
              size="lg"
              type="button"
              variant="link"
            >
              {rejectMutation.isPending ? "Declining..." : "Decline"}
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}
