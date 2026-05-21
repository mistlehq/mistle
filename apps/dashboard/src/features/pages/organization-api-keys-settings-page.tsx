import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { useAppPageMeta } from "../navigation/route-meta.js";
import {
  apiKeysQueryKey,
  listApiKeys,
  revokeApiKey,
  type ApiKey,
} from "../settings/api-keys/api-keys-service.js";
import { PageFrame, resolvePageFrameText } from "../shared/page-frame.js";
import { useRequiredOrganizationId } from "../shell/require-auth.js";
import { resolveRevokingApiKeyId } from "./organization-api-keys-settings-page-state.js";
import { OrganizationApiKeysSettingsPageView } from "./organization-api-keys-settings-page-view.js";

type CreatedApiKeyNotice = {
  name: string;
  token: string;
};

export function OrganizationApiKeysSettingsPage(): React.JSX.Element {
  const pageMeta = useAppPageMeta();
  const activeOrganizationId = useRequiredOrganizationId();
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [createdApiKeyNotice, setCreatedApiKeyNotice] = useState<CreatedApiKeyNotice | null>(() =>
    readCreatedApiKeyNotice(location.state),
  );
  const { title, description } = resolvePageFrameText(pageMeta, "API Keys");
  const queryKey = apiKeysQueryKey(activeOrganizationId);
  const apiKeysQuery = useQuery({
    queryKey,
    queryFn: async ({ signal }) => listApiKeys({ signal }),
  });
  const revokeMutation = useMutation({
    mutationFn: revokeApiKey,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  useEffect(() => {
    if (readCreatedApiKeyNotice(location.state) === null) {
      return;
    }

    void navigate(location.pathname + location.search, {
      replace: true,
      state: null,
    });
  }, [location.pathname, location.search, location.state, navigate]);

  return (
    <PageFrame description={description} title={title}>
      <OrganizationApiKeysSettingsPageView
        apiKeys={apiKeysQuery.data?.items ?? []}
        createdApiKeyNotice={createdApiKeyNotice}
        isLoading={apiKeysQuery.isPending}
        listErrorMessage={
          apiKeysQuery.isError
            ? resolveApiErrorMessage({
                error: apiKeysQuery.error,
                fallbackMessage: "Could not load API keys.",
              })
            : null
        }
        onRevokeApiKey={(apiKey: ApiKey) => {
          revokeMutation.mutate({ apiKeyId: apiKey.id });
        }}
        onDismissCreatedApiKeyNotice={() => {
          setCreatedApiKeyNotice(null);
        }}
        revokeErrorMessage={
          revokeMutation.isError
            ? resolveApiErrorMessage({
                error: revokeMutation.error,
                fallbackMessage: "Could not revoke API key.",
              })
            : null
        }
        revokingApiKeyId={resolveRevokingApiKeyId(revokeMutation)}
      />
    </PageFrame>
  );
}

function readCreatedApiKeyNotice(value: unknown): CreatedApiKeyNotice | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const createdApiKey = Reflect.get(value, "createdApiKey");
  if (typeof createdApiKey !== "object" || createdApiKey === null) {
    return null;
  }

  const name = Reflect.get(createdApiKey, "name");
  const token = Reflect.get(createdApiKey, "token");
  if (typeof name !== "string" || name.length === 0) {
    return null;
  }
  if (typeof token !== "string" || token.length === 0) {
    return null;
  }

  return {
    name,
    token,
  };
}
