// Best-effort parsing, only used to populate the "Active Sessions" list in Settings —
// not relied on for any security decision.
export function parseUserAgent(userAgent?: string | null): {
  browser: string;
  deviceType: 'DESKTOP' | 'MOBILE';
} {
  const ua = userAgent || '';
  const deviceType: 'DESKTOP' | 'MOBILE' = /mobile|android|iphone|ipad/i.test(ua)
    ? 'MOBILE'
    : 'DESKTOP';

  let browser = 'Unknown Browser';
  if (/edg\//i.test(ua)) browser = 'Edge';
  else if (/chrome\//i.test(ua) && !/chromium/i.test(ua)) browser = 'Chrome';
  else if (/firefox\//i.test(ua)) browser = 'Firefox';
  else if (/safari\//i.test(ua) && !/chrome\//i.test(ua)) browser = 'Safari';

  return { browser, deviceType };
}
