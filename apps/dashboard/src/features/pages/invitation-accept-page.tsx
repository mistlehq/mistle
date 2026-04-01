import { Button, Notice } from "@mistle/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { AuthPageShell, AuthPageWidths } from "../auth/auth-page-shell.js";
import { AuthStatusPage } from "../auth/auth-status-page.js";
import { EmailStage } from "../auth/email-stage.js";
import { OtpStage } from "../auth/otp-stage.js";
import { SESSION_QUERY_KEY, useSessionQuery } from "../shell/session-query.js";
import {
  acceptInvitationAndSetActiveOrganization,
  fetchInvitation,
  rejectInvitation,
} from "./invitation-accept-service.js";
import {
  isInvitationFetchDifferentAccountError,
  isInvitationMutationUnavailableError,
  toInvitationFetchErrorMessage,
  toInvitationMutationErrorMessage,
} from "./invitation-accept-state.js";
import { InvitationAccessView } from "./invitation-access-view.js";
import { InvitationAuthPrompt } from "./invitation-auth-prompt.js";
import { InvitationLoadingState } from "./invitation-loading-state.js";
import { getInvitationPageState } from "./invitation-page-state.js";
import { useInvitationAuth } from "./use-invitation-auth.js";

type InviteDecision = "idle" | "accepted" | "rejected";

function renderInvitationErrorState(message: string): React.JSX.Element {
  return (
    <AuthStatusPage
      align="center"
      maxWidthClass={AuthPageWidths.LG}
      title="Oops, something went wrong"
    >
      <Notice variant="alert">{message}</Notice>
    </AuthStatusPage>
  );
}

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
  const [isInvitationUnavailable, setIsInvitationUnavailable] = useState(false);
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
      setIsInvitationUnavailable(false);
      setDecision("accepted");
      await queryClient.invalidateQueries({
        queryKey: SESSION_QUERY_KEY,
      });
    },
    onError: (error: unknown) => {
      setIsInvitationUnavailable(isInvitationMutationUnavailableError(error));
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
      setIsInvitationUnavailable(false);
      setDecision("rejected");
    },
    onError: (error: unknown) => {
      setIsInvitationUnavailable(isInvitationMutationUnavailableError(error));
      setMutationError(toInvitationMutationErrorMessage(error, "reject"));
    },
  });

  const invitationErrorMessage = invitationQuery.isError
    ? toInvitationFetchErrorMessage(invitationQuery.error)
    : null;
  const invitation = invitationQuery.data;
  const invitationOrganizationName =
    invitation?.organizationName ?? organizationNameFromLink ?? null;
  const invitationInviterDisplay =
    invitation?.inviterEmail ?? inviterEmailFromLink ?? invitation?.inviterId ?? null;
  const pageState = getInvitationPageState({
    authStep,
    decision,
    invitation,
    invitationErrorMessage,
    invitationId,
    invitationInviterDisplay,
    invitationOrganizationName,
    isInvitationError: invitationQuery.isError,
    isInvitationFetchDifferentAccount:
      invitationQuery.isError && isInvitationFetchDifferentAccountError(invitationQuery.error),
    isInvitationPending: invitationQuery.isPending,
    isInvitationUnavailable,
    isSessionError: sessionQuery.isError,
    isSessionPending: sessionQuery.isPending,
    isWrongAccountFromInviteLink,
    mutationError,
    sessionExists: sessionQuery.data !== null,
  });

  if (pageState.kind === "loading_session" || pageState.kind === "loading_invitation") {
    return <InvitationLoadingState />;
  }

  if (pageState.kind === "missing_id") {
    return renderInvitationErrorState(pageState.message);
  }

  if (pageState.kind === "session_error") {
    return renderInvitationErrorState(pageState.message);
  }

  if (pageState.kind === "auth_required") {
    return (
      <AuthPageShell
        maxWidthClass={pageState.authStep === "otp" ? AuthPageWidths.SM : AuthPageWidths.LG}
        title={pageState.authStep === "email" ? "You've been invited to join Mistle" : null}
      >
        {pageState.authStep === "email" ? (
          <EmailStage
            authError={authError}
            beforeForm={
              <InvitationAuthPrompt
                email={email}
                invitedBy={inviterEmailFromLink}
                organizationName={organizationNameFromLink}
              />
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

  if (pageState.kind === "wrong_account") {
    return renderInvitationErrorState(pageState.message);
  }

  if (pageState.kind === "invitation_error") {
    return renderInvitationErrorState(pageState.message);
  }

  if (pageState.kind === "accepted") {
    return (
      <AuthStatusPage
        align="center"
        maxWidthClass={AuthPageWidths.LG}
        title="Invitation accepted"
        actions={
          <Button
            className="h-12 w-full text-sm"
            onClick={() => void navigate("/", { replace: true })}
            size="lg"
            type="button"
          >
            Continue
          </Button>
        }
      >
        <Notice>
          <p className="text-center">You now have access to {pageState.organizationName}.</p>
        </Notice>
      </AuthStatusPage>
    );
  }

  if (pageState.kind === "declined") {
    return (
      <AuthStatusPage align="center" maxWidthClass={AuthPageWidths.XL} title="Invitation declined">
        <Notice>
          <p className="text-center">You declined this invitation.</p>
        </Notice>
      </AuthStatusPage>
    );
  }

  if (pageState.kind === "invitation_unavailable") {
    return renderInvitationErrorState(pageState.message);
  }

  return (
    <InvitationAccessView
      invitedBy={pageState.inviterDisplay}
      invitedEmail={pageState.invitation.email}
      isAccepting={acceptMutation.isPending}
      isDeclining={rejectMutation.isPending}
      mutationError={mutationError}
      onAccept={() => {
        setIsInvitationUnavailable(false);
        setMutationError(null);
        acceptMutation.mutate();
      }}
      onDecline={() => {
        setIsInvitationUnavailable(false);
        setMutationError(null);
        rejectMutation.mutate();
      }}
      organizationName={pageState.organizationName}
      role={pageState.invitation.role}
    />
  );
}
