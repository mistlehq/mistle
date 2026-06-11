const TrustedChatLinkDomains = ["github.com", "mistle.dev", "linear.app", "atlassian.net"];

export function isTrustedChatLink(url: string): boolean {
  try {
    const parsedUrl = new URL(url);

    return parsedUrl.protocol === "https:" && isTrustedHostname(parsedUrl.hostname);
  } catch {
    return false;
  }
}

function isTrustedHostname(hostname: string): boolean {
  return TrustedChatLinkDomains.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
  );
}
