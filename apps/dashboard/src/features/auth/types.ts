import type { UserAppearance } from "../appearance/appearance.js";

export type AuthClientError = {
  message?: string | undefined;
} | null;

export type AuthenticatedSessionData = {
  session: {
    id?: string;
    createdAt?: Date;
    updatedAt?: Date;
    expiresAt?: Date;
    token?: string;
    userId?: string;
    activeOrganizationId?: string | null | undefined;
  };
  user: {
    id: string;
    name: string;
    email: string;
    emailVerified?: boolean | undefined;
    image?: string | null | undefined;
    createdAt?: Date | undefined;
    updatedAt?: Date | undefined;
    appearance?: UserAppearance | undefined;
  };
};

export type SessionData = AuthenticatedSessionData | null;
