export function redactNetworkLogUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const base = `${url.origin}${url.pathname}`;
    return url.search ? `${base}?<redacted>` : base;
  } catch {
    return "<invalid-url>";
  }
}
