import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { useAppPageMeta } from "../navigation/route-meta.js";
import { apiKeysQueryKey, createApiKey } from "../settings/api-keys/api-keys-service.js";
import { PageFrame, resolvePageFrameText } from "../shared/page-frame.js";
import { useRequiredOrganizationId } from "../shell/require-auth.js";
import { OrganizationApiKeyCreatePageView } from "./organization-api-key-create-page-view.js";

export function OrganizationApiKeyCreatePage(): React.JSX.Element {
  const pageMeta = useAppPageMeta();
  const activeOrganizationId = useRequiredOrganizationId();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { title, description } = resolvePageFrameText(pageMeta, "Create API key");
  const createMutation = useMutation({
    mutationFn: createApiKey,
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: apiKeysQueryKey(activeOrganizationId) });
      void navigate("/settings/organization/api-keys", {
        state: {
          createdApiKey: {
            name: created.apiKey.name,
            token: created.token,
          },
        },
      });
    },
  });

  return (
    <PageFrame width="form" description={description} title={title}>
      <OrganizationApiKeyCreatePageView
        createErrorMessage={
          createMutation.isError
            ? resolveApiErrorMessage({
                error: createMutation.error,
                fallbackMessage: "Could not create API key.",
              })
            : null
        }
        isCreating={createMutation.isPending}
        onCreateApiKey={(input) => {
          createMutation.mutate(input);
        }}
      />
    </PageFrame>
  );
}
