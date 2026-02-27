export type SandboxProfileStatus = "active" | "inactive";

export type SandboxProfile = {
  id: string;
  organizationId: string;
  displayName: string;
  status: SandboxProfileStatus;
  createdAt: string;
  updatedAt: string;
};

export type KeysetPageCursor = {
  limit: number;
  after: string;
};

export type KeysetPreviousPageCursor = {
  limit: number;
  before: string;
};

export type SandboxProfilesListResult = {
  totalResults: number;
  items: SandboxProfile[];
  nextPage: KeysetPageCursor | null;
  previousPage: KeysetPreviousPageCursor | null;
};

export type CreateSandboxProfileInput = {
  displayName: string;
  status?: SandboxProfileStatus;
};

export type UpdateSandboxProfileInput = {
  profileId: string;
  displayName?: string;
  status?: SandboxProfileStatus;
};
