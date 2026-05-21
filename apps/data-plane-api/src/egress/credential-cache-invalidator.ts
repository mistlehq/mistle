export type CredentialCacheInvalidationResult = {
  deletedEntryCount: number;
};

export interface CredentialCacheInvalidator {
  invalidateIntegrationConnection(input: {
    connectionId: string;
  }): Promise<CredentialCacheInvalidationResult>;
}
