import { dateFromEpochMs } from "@mistle/time";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Spinner,
} from "@mistle/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";

import { authClient } from "../../lib/auth/client.js";
import { MISSING_ACTIVE_ORGANIZATION_ERROR_MESSAGE } from "./active-organization.js";
import { resolveNoOrganizationRecoveryViewState } from "./no-organization-recovery-state.js";
import { SESSION_QUERY_KEY } from "./session-query.js";

type UserInvitation = {
  id: string;
  organizationName: string;
  role: string;
  expiresAt: string;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: Record<string, unknown>, key: string): string | null {
  const candidate = value[key];
  return typeof candidate === "string" ? candidate : null;
}

function parseUserInvitations(value: unknown): UserInvitation[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const parsed: UserInvitation[] = [];
  for (const entry of value) {
    if (!isObjectRecord(entry)) {
      return null;
    }

    const id = readString(entry, "id");
    const organizationName = readString(entry, "organizationName");
    const role = readString(entry, "role");
    const expiresAt = readString(entry, "expiresAt");
    if (id === null || organizationName === null || role === null || expiresAt === null) {
      return null;
    }

    parsed.push({
      id,
      organizationName,
      role,
      expiresAt,
    });
  }

  return parsed;
}

function slugifyOrganizationName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatExpiryDate(value: string): string {
  const parsedEpochMs = Date.parse(value);
  if (Number.isNaN(parsedEpochMs)) {
    return "Unknown expiry";
  }
  const parsed = dateFromEpochMs(parsedEpochMs);
  return `Expires ${parsed.toLocaleDateString()}`;
}

export function NoOrganizationRecoveryCard(): React.JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [organizationName, setOrganizationName] = useState("");
  const [organizationSlug, setOrganizationSlug] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const invitationsQuery = useQuery({
    queryKey: ["auth", "user-invitations"],
    queryFn: async () => {
      const response = await authClient.$fetch("/organization/list-user-invitations", {
        method: "GET",
        throw: true,
      });
      const parsed = parseUserInvitations(response);
      if (parsed === null) {
        throw new Error("Invalid invitations payload.");
      }
      return parsed;
    },
    retry: false,
  });

  const createOrganizationMutation = useMutation({
    mutationFn: async (input: { name: string; slug: string }) => {
      const createdOrganization = await authClient.$fetch("/organization/create", {
        method: "POST",
        throw: true,
        body: {
          name: input.name,
          slug: input.slug,
        },
      });

      if (!isObjectRecord(createdOrganization)) {
        throw new Error("Invalid organization payload.");
      }
      const organizationId = readString(createdOrganization, "id");
      if (organizationId === null) {
        throw new Error("Created organization is missing ID.");
      }

      await authClient.$fetch("/organization/set-active", {
        method: "POST",
        throw: true,
        body: {
          organizationId,
        },
      });
    },
    onSuccess: async () => {
      setCreateError(null);
      await queryClient.invalidateQueries({
        queryKey: SESSION_QUERY_KEY,
      });
    },
    onError: (error: unknown) => {
      if (!isObjectRecord(error)) {
        setCreateError("Unable to create organization.");
        return;
      }
      const message = readString(error, "message");
      setCreateError(message ?? "Unable to create organization.");
    },
  });

  const pendingInvitations = invitationsQuery.data ?? [];
  const recoveryViewState = resolveNoOrganizationRecoveryViewState({
    isPending: invitationsQuery.isPending,
    isError: invitationsQuery.isError,
    hasPendingInvitations: pendingInvitations.length > 0,
  });
  const suggestedSlug = useMemo(
    () => slugifyOrganizationName(organizationName),
    [organizationName],
  );

  async function handleCreateOrganization(
    event: React.SyntheticEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setCreateError(null);

    const name = organizationName.trim();
    const slug = organizationSlug.trim().length === 0 ? suggestedSlug : organizationSlug.trim();

    if (name.length === 0) {
      setCreateError("Organization name is required.");
      return;
    }
    if (slug.length === 0) {
      setCreateError("Organization slug is required.");
      return;
    }

    createOrganizationMutation.mutate({
      name,
      slug,
    });
  }

  return (
    <main className="from-background to-muted/20 min-h-svh bg-linear-to-b">
      <div className="mx-auto flex min-h-svh w-full max-w-2xl items-center px-4 py-8">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Mistle dashboard</CardTitle>
            <CardDescription>Organization context is unavailable.</CardDescription>
          </CardHeader>
          <CardContent className="gap-6 grid">
            <p className="text-muted-foreground text-sm">
              {MISSING_ACTIVE_ORGANIZATION_ERROR_MESSAGE}
            </p>

            {recoveryViewState === "loading" ? (
              <div className="text-muted-foreground flex items-center gap-2 text-sm">
                <Spinner />
                Loading invitations...
              </div>
            ) : null}

            {recoveryViewState === "error" ? (
              <p className="text-destructive text-sm">Unable to load your invitations.</p>
            ) : null}

            {recoveryViewState === "pending" ? (
              <section className="gap-3 grid">
                <h2 className="text-base font-medium">Pending invitations</h2>
                <div className="gap-2 grid">
                  {pendingInvitations.map((invitation) => (
                    <div
                      className="bg-muted/30 flex items-center justify-between rounded-md border px-3 py-2"
                      key={invitation.id}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{invitation.organizationName}</p>
                        <p className="text-muted-foreground text-xs">
                          Role: {invitation.role} • {formatExpiryDate(invitation.expiresAt)}
                        </p>
                      </div>
                      <Button
                        onClick={() => {
                          void navigate(
                            `/invitations/accept?invitationId=${encodeURIComponent(invitation.id)}`,
                          );
                        }}
                        size="sm"
                        type="button"
                      >
                        Review
                      </Button>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {recoveryViewState === "empty" ? (
              <section className="gap-3 grid">
                <h2 className="text-base font-medium">No pending invitations</h2>
                <p className="text-muted-foreground text-sm">
                  Create your own organization to continue.
                </p>
                <form
                  className="gap-3 grid"
                  onSubmit={(event) => void handleCreateOrganization(event)}
                >
                  <div className="gap-1 grid">
                    <Label htmlFor="organization-name">Organization name</Label>
                    <Input
                      id="organization-name"
                      onChange={(event) => setOrganizationName(event.currentTarget.value)}
                      placeholder="Acme Inc"
                      value={organizationName}
                    />
                  </div>
                  <div className="gap-1 grid">
                    <Label htmlFor="organization-slug">Organization slug</Label>
                    <Input
                      id="organization-slug"
                      onChange={(event) => setOrganizationSlug(event.currentTarget.value)}
                      placeholder={suggestedSlug.length === 0 ? "acme-inc" : suggestedSlug}
                      value={organizationSlug}
                    />
                  </div>
                  {createError === null ? null : (
                    <p className="text-destructive text-sm">{createError}</p>
                  )}
                  <Button disabled={createOrganizationMutation.isPending} type="submit">
                    {createOrganizationMutation.isPending ? "Creating..." : "Create organization"}
                  </Button>
                </form>
              </section>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
