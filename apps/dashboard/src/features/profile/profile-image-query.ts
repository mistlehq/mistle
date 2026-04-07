import { useQuery } from "@tanstack/react-query";

import { getProfileImage } from "../settings/profile/profile-service.js";
import {
  resolveSignedImageRefetchInterval,
  resolveSignedImageStaleTime,
} from "../shared/signed-image-query-policy.js";

export const PROFILE_IMAGE_QUERY_KEY: readonly ["settings", "profile-image"] = [
  "settings",
  "profile-image",
];

export function useProfileImageQuery() {
  return useQuery({
    queryKey: PROFILE_IMAGE_QUERY_KEY,
    queryFn: getProfileImage,
    staleTime: (query) =>
      resolveSignedImageStaleTime({
        refreshAfterSeconds: query.state.data?.refreshAfterSeconds,
      }),
    refetchInterval: (query) =>
      resolveSignedImageRefetchInterval({
        refreshAfterSeconds: query.state.data?.refreshAfterSeconds,
      }),
  });
}
