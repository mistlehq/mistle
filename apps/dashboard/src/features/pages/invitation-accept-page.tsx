import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Spinner,
} from "@mistle/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { getDashboardConfig } from "../../config.js";
import { authClient } from "../../lib/auth/client.js";
import {
  createStateForDifferentEmail,
  resolveEmailValidationError,
  resolveOtpValidationError,
} from "../auth/auth-flow.js";
import { EmailStepForm } from "../auth/email-step-form.js";
import { ErrorNotice } from "../auth/error-notice.js";
import { resolveErrorMessage } from "../auth/messages.js";
import { OtpStepForm } from "../auth/otp-step-form.js";
import { SESSION_QUERY_KEY, useSessionQuery } from "../shell/session-query.js";
import {
  formatInvitationRole,
  isInvitationFetchDifferentAccountError,
  parseInvitationDetails,
  toInvitationFetchErrorMessage,
  toInvitationMutationErrorMessage,
  type InvitationDetails,
} from "./invitation-accept-state.js";

type InviteDecision = "idle" | "accepted" | "rejected";
type AuthApiRequestMethod = "GET" | "POST";

const dashboardConfig = getDashboardConfig();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readErrorMessage(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }

  const message = value["message"];
  return typeof message === "string" ? message : null;
}

async function readResponsePayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type");
  if (contentType !== null && contentType.toLowerCase().includes("application/json")) {
    return response.json();
  }

  return response.text();
}

async function fetchAuthApi(input: {
  path: string;
  method: AuthApiRequestMethod;
  query?: Record<string, string>;
  body?: Record<string, string>;
}): Promise<unknown> {
  const url = new URL(
    `${dashboardConfig.authBasePath}${input.path}`,
    dashboardConfig.controlPlaneApiOrigin,
  );
  if (input.query !== undefined) {
    for (const [key, value] of Object.entries(input.query)) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url, {
    method: input.method,
    credentials: "include",
    ...(input.body === undefined
      ? {}
      : {
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(input.body),
        }),
  });
  const payload = await readResponsePayload(response);

  if (!response.ok) {
    throw {
      status: response.status,
      statusCode: response.status,
      message: readErrorMessage(payload) ?? response.statusText,
      body: payload,
    };
  }

  return payload;
}

async function fetchInvitation(invitationId: string): Promise<InvitationDetails> {
  const response = await fetchAuthApi({
    path: "/organization/get-invitation",
    method: "GET",
    query: { id: invitationId },
  });
  const parsed = parseInvitationDetails(response);
  if (parsed === null) {
    throw new Error("Invalid invitation payload.");
  }
  return parsed;
}

export function InvitationAcceptPage(): React.JSX.Element {
  const [searchParams] = useSearchParams();
  const invitationId = searchParams.get("invitationId");
  const invitedEmailFromLink = searchParams.get("email");
  const organizationNameFromLink = searchParams.get("organizationName");
  const invitedByFromLink = searchParams.get("invitedBy");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sessionQuery = useSessionQuery();
  const [decision, setDecision] = useState<InviteDecision>("idle");
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [email, setEmail] = useState(() =>
    invitedEmailFromLink === null ? "" : invitedEmailFromLink,
  );
  const [otp, setOtp] = useState("");
  const [authStep, setAuthStep] = useState<"email" | "otp">("email");
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
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

      await fetchAuthApi({
        path: "/organization/accept-invitation",
        method: "POST",
        body: { invitationId },
      });

      await fetchAuthApi({
        path: "/organization/set-active",
        method: "POST",
        body: { organizationId },
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
      await fetchAuthApi({
        path: "/organization/reject-invitation",
        method: "POST",
        body: { invitationId },
      });
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

  async function handleSendOtp(event: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setAuthError(null);

    const emailError = resolveEmailValidationError(email);
    if (emailError) {
      setAuthError(emailError);
      return;
    }

    const emailValue = email.trim();
    setIsSendingOtp(true);
    const response = await authClient.emailOtp.sendVerificationOtp({
      email: emailValue,
      type: "sign-in",
    });
    setIsSendingOtp(false);

    if (response.error) {
      setAuthError(resolveErrorMessage(response.error, "Unable to send OTP."));
      return;
    }

    setEmail(emailValue);
    setOtp("");
    setAuthStep("otp");
  }

  async function handleVerifyOtp(event: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setAuthError(null);

    const otpError = resolveOtpValidationError(otp);
    if (otpError) {
      setAuthError(otpError);
      return;
    }

    const otpValue = otp.trim();
    setIsVerifyingOtp(true);
    const signInResponse = await authClient.signIn.emailOtp({
      email,
      otp: otpValue,
    });
    setIsVerifyingOtp(false);

    if (signInResponse.error) {
      setAuthError(resolveErrorMessage(signInResponse.error, "Unable to verify OTP."));
      return;
    }

    await queryClient.invalidateQueries({
      queryKey: SESSION_QUERY_KEY,
    });
  }

  function handleUseDifferentEmail(): void {
    const nextState = createStateForDifferentEmail();
    setAuthError(nextState.authError);
    setOtp(nextState.otp);
    setAuthStep(nextState.authStep);
  }

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
      <main className="from-background to-muted/20 min-h-svh bg-linear-to-b">
        <div className="mx-auto flex min-h-svh w-full max-w-xl items-center px-4 py-8">
          <Card className="w-full">
            <CardHeader>
              <CardTitle>Organization invitation</CardTitle>
              <CardDescription>Invitation ID is missing.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => void navigate("/", { replace: true })} type="button">
                Go to dashboard
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  if (sessionQuery.isPending) {
    return (
      <main className="from-background to-muted/20 min-h-svh bg-linear-to-b">
        <div className="mx-auto flex min-h-svh w-full max-w-xl items-center px-4 py-8">
          <Card className="w-full">
            <CardHeader>
              <CardTitle>Organization invitation</CardTitle>
              <CardDescription>Checking your session.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-muted-foreground gap-2 flex items-center">
                <Spinner />
                Loading...
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  if (sessionQuery.isError) {
    return (
      <main className="from-background to-muted/20 min-h-svh bg-linear-to-b">
        <div className="mx-auto flex min-h-svh w-full max-w-xl items-center px-4 py-8">
          <Card className="w-full">
            <CardHeader>
              <CardTitle>Organization invitation</CardTitle>
              <CardDescription>Session check failed.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-destructive text-sm">{sessionQuery.error.message}</p>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  if (sessionQuery.data === null) {
    return (
      <main className="from-background to-muted/20 min-h-svh bg-linear-to-b">
        <div className="mx-auto flex min-h-svh w-full max-w-xl items-center px-4 py-8">
          <Card className="w-full">
            <CardHeader>
              <CardTitle>Organization invitation</CardTitle>
              <CardDescription>Sign in to view and respond to this invitation.</CardDescription>
            </CardHeader>
            <CardContent className="gap-4 grid">
              {organizationNameFromLink === null || organizationNameFromLink.length === 0 ? null : (
                <p className="text-sm">
                  <span className="text-muted-foreground">Organization:</span>{" "}
                  <span className="font-medium">{organizationNameFromLink}</span>
                </p>
              )}
              {invitedByFromLink === null || invitedByFromLink.length === 0 ? null : (
                <p className="text-sm">
                  <span className="text-muted-foreground">Invited by:</span>{" "}
                  <span className="font-medium">{invitedByFromLink}</span>
                </p>
              )}
              <ErrorNotice message={authError} />
              {authStep === "email" ? (
                <EmailStepForm
                  email={email}
                  isSendingOtp={isSendingOtp}
                  onEmailChange={setEmail}
                  onSubmit={handleSendOtp}
                />
              ) : (
                <OtpStepForm
                  email={email}
                  isVerifyingOtp={isVerifyingOtp}
                  onOtpChange={setOtp}
                  onSubmit={handleVerifyOtp}
                  onUseDifferentEmail={handleUseDifferentEmail}
                  otp={otp}
                />
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  if (isWrongAccountFromInviteLink) {
    return (
      <main className="from-background to-muted/20 min-h-svh bg-linear-to-b">
        <div className="mx-auto flex min-h-svh w-full max-w-xl items-center px-4 py-8">
          <Card className="w-full">
            <CardHeader>
              <CardTitle>Organization invitation</CardTitle>
              <CardDescription>This invitation cannot be opened.</CardDescription>
            </CardHeader>
            <CardContent className="gap-4 grid">
              <p className="text-destructive text-sm">
                This invitation belongs to a different account.
              </p>
              {signOutError === null ? null : (
                <p className="text-destructive text-sm">{signOutError}</p>
              )}
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
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  if (invitationQuery.isError) {
    return (
      <main className="from-background to-muted/20 min-h-svh bg-linear-to-b">
        <div className="mx-auto flex min-h-svh w-full max-w-xl items-center px-4 py-8">
          <Card className="w-full">
            <CardHeader>
              <CardTitle>Organization invitation</CardTitle>
              <CardDescription>This invitation cannot be opened.</CardDescription>
            </CardHeader>
            <CardContent className="gap-4 grid">
              <p className="text-destructive text-sm">{invitationErrorMessage}</p>
              {signOutError === null ? null : (
                <p className="text-destructive text-sm">{signOutError}</p>
              )}
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
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  if (invitationQuery.isPending || invitationQuery.data === undefined) {
    return (
      <main className="from-background to-muted/20 min-h-svh bg-linear-to-b">
        <div className="mx-auto flex min-h-svh w-full max-w-xl items-center px-4 py-8">
          <Card className="w-full">
            <CardHeader>
              <CardTitle>Organization invitation</CardTitle>
              <CardDescription>Loading invitation details.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-muted-foreground gap-2 flex items-center">
                <Spinner />
                Loading...
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  const invitation = invitationQuery.data;
  const invitationOrganizationName =
    invitation.organizationName ?? organizationNameFromLink ?? "this organization";
  const invitationInviterDisplay =
    invitation.inviterEmail ?? invitedByFromLink ?? invitation.inviterId;

  if (decision === "accepted") {
    return (
      <main className="from-background to-muted/20 min-h-svh bg-linear-to-b">
        <div className="mx-auto flex min-h-svh w-full max-w-xl items-center px-4 py-8">
          <Card className="w-full">
            <CardHeader>
              <CardTitle>Invitation accepted</CardTitle>
              <CardDescription>
                You now have access to {invitationOrganizationName}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => void navigate("/", { replace: true })} type="button">
                Go to dashboard
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  if (decision === "rejected") {
    return (
      <main className="from-background to-muted/20 min-h-svh bg-linear-to-b">
        <div className="mx-auto flex min-h-svh w-full max-w-xl items-center px-4 py-8">
          <Card className="w-full">
            <CardHeader>
              <CardTitle>Invitation declined</CardTitle>
              <CardDescription>You declined this invitation.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={() => void navigate("/", { replace: true })}
                type="button"
                variant="outline"
              >
                Go to dashboard
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main className="from-background to-muted/20 min-h-svh bg-linear-to-b">
      <div className="mx-auto flex min-h-svh w-full max-w-xl items-center px-4 py-8">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Organization invitation</CardTitle>
            <CardDescription>Review and respond to your invitation.</CardDescription>
          </CardHeader>
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

            {mutationError === null ? null : (
              <p className="text-destructive text-sm">{mutationError}</p>
            )}

            <div className="gap-2 flex flex-wrap">
              <Button
                disabled={isSubmitting}
                onClick={() => {
                  setMutationError(null);
                  acceptMutation.mutate();
                }}
                type="button"
              >
                {acceptMutation.isPending ? "Accepting..." : "Accept invitation"}
              </Button>
              <Button
                disabled={isSubmitting}
                onClick={() => {
                  setMutationError(null);
                  rejectMutation.mutate();
                }}
                type="button"
                variant="outline"
              >
                {rejectMutation.isPending ? "Declining..." : "Decline"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
