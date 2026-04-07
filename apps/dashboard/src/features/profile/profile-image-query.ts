import { useQuery } from "@tanstack/react-query";

import { getProfileImage } from "../settings/profile/profile-service.js";
import {
  resolveSignedImageRefetchInterval,
  SIGNED_IMAGE_URL_REFRESH_INTERVAL_MS,
} from "../shared/signed-image-query-policy.js";

export const PROFILE_IMAGE_QUERY_KEY: readonly ["settings", "profile-image"] = [
  "settings",
  "profile-image",
];

export function useProfileImageQuery() {
  return useQuery({
    queryKey: PROFILE_IMAGE_QUERY_KEY,
    queryFn: getProfileImage,
    staleTime: SIGNED_IMAGE_URL_REFRESH_INTERVAL_MS,
    refetchInterval: (query) =>
      resolveSignedImageRefetchInterval({
        imageUrl: query.state.data?.imageUrl,
      }),
  });
}
