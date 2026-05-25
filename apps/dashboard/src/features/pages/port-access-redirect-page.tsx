import { useEffect, useState } from "react";
import { useParams } from "react-router";

import { redeemPortAccessLink } from "../sessions/sessions-service.js";

export function PortAccessRedirectPage(): React.JSX.Element | null {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const [error, setError] = useState<Error | undefined>(undefined);

  useEffect(() => {
    if (slug === undefined) {
      setError(new Error("Port Access link slug is missing."));
      return;
    }

    const abortController = new AbortController();

    redeemPortAccessLink({
      slug,
      signal: abortController.signal,
    })
      .then((url) => {
        window.location.assign(url);
      })
      .catch((error: unknown) => {
        if (abortController.signal.aborted) {
          return;
        }

        setError(error instanceof Error ? error : new Error("Failed to redeem Port Access link."));
      });

    return () => {
      abortController.abort();
    };
  }, [slug]);

  if (error !== undefined) {
    throw error;
  }

  return null;
}
