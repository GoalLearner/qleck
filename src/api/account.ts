// Account surface (P3): Sign in with Apple + email OTP + password — every
// door resolves to the same session the client swaps into qleck-identity.
// Sign-up PROMOTES the device's anonymous user (goals kept); an identity
// that already has an account logs in instead.
import { adoptIdentity, apiBase, authedFetch, getIdentity, type DeviceIdentity } from './device';
import { getDeviceId } from './coach';

export interface SessionResult {
  userId: string;
  token: string;
  refreshToken?: string;
  /** true = this identity already had an account (login); false = the current
   *  anonymous device user was just promoted (its goals came along). */
  existing: boolean;
}

function adoptSession(out: SessionResult, provider: 'apple' | 'email'): void {
  const identity: DeviceIdentity = {
    userId: out.userId, token: out.token, provider,
    ...(out.refreshToken ? { refreshToken: out.refreshToken } : {}),
  };
  adoptIdentity(identity);
}

async function post<T>(path: string, body: unknown, opts: { bearer?: boolean } = {}): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.bearer !== false) {
    const { token } = await getIdentity();
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(apiBase() + path, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as T };
}

/**
 * Exchange an Apple identity token for an account session. The current
 * anonymous Bearer rides along so a first sign-in PROMOTES this device's
 * user (goals kept) instead of starting empty.
 */
export async function appleAuth(identityToken: string): Promise<SessionResult> {
  const { status, body } = await post<SessionResult & { error?: string }>('/auth/apple', { identityToken, wantsSession: true });
  if (status !== 200 || !body.userId || !body.token) throw new Error(body.error ?? `apple_auth_failed_${status}`);
  adoptSession(body, 'apple');
  return body;
}

/* ── email OTP + password (P3) ──────────────────────────────────────────── */

export type CodePurpose = 'signup' | 'login' | 'reset';

/** Ask for a code. `exists` drives the duplicate-account sheet; when
 *  (purpose==='signup') === exists nothing was sent. */
export async function startEmailCode(email: string, purpose: CodePurpose): Promise<{ exists: boolean; sent: boolean }> {
  const { status, body } = await post<{ exists?: boolean; sent?: boolean; error?: string }>(
    '/auth/email/start', { email, purpose }, { bearer: false },
  );
  if (status === 429) throw new Error('rate_limited');
  if (status !== 200) throw new Error(body.error ?? `start_failed_${status}`);
  return { exists: !!body.exists, sent: !!body.sent };
}

/**
 * Verify a code. For 'signup' the session is adopted (this IS the account
 * from here on). For 'reset' the session is RETURNED but not adopted — the
 * caller uses its token to set the new password, then logs in properly.
 */
export async function verifyEmailCode(email: string, code: string, purpose: CodePurpose): Promise<SessionResult> {
  const { status, body } = await post<SessionResult & { error?: string }>('/auth/email/verify', { email, code, purpose });
  if (status !== 200 || !body.userId || !body.token) throw new Error(body.error ?? `verify_failed_${status}`);
  if (purpose !== 'reset') adoptSession(body, 'email');
  return body;
}

export async function loginWithPassword(email: string, password: string): Promise<SessionResult> {
  const { status, body } = await post<SessionResult & { error?: string }>('/auth/login', { email, password }, { bearer: false });
  if (status !== 200 || !body.userId || !body.token) throw new Error(body.error ?? `login_failed_${status}`);
  adoptSession(body, 'email');
  return body;
}

/** Set the password for a session — the reset funnel passes the verify
 *  session's token explicitly; settings-era callers omit it (own identity). */
export async function setPassword(password: string, withToken?: string): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  headers.Authorization = `Bearer ${withToken ?? (await getIdentity()).token}`;
  const res = await fetch(apiBase() + '/auth/password/set', { method: 'POST', headers, body: JSON.stringify({ password }) });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `set_password_failed_${res.status}`);
  }
  // Setting a password now ends every session on the account — including this
  // one — so the server hands back a replacement. Adopt it, or the very next
  // request presents the token the reset just revoked and the reuse trap
  // signs the user out of the device they are holding.
  const body = (await res.json().catch(() => ({}))) as Partial<SessionResult>;
  if (body.userId && body.token) adoptSession(body as SessionResult, 'email');
}

export type UnameApiStatus = 'free' | 'taken' | 'short' | 'invalid';

export async function checkUsername(u: string): Promise<UnameApiStatus> {
  const res = await fetch(apiBase() + `/auth/username?u=${encodeURIComponent(u)}`);
  if (!res.ok) throw new Error(`username_check_${res.status}`);
  const body = (await res.json()) as { status?: UnameApiStatus };
  return body.status ?? 'invalid';
}

/** Revoke this device's refresh token server-side. Fire-and-forget friendly. */
export async function logoutServer(): Promise<void> {
  try {
    const identity = await getIdentity();
    if (!identity.refreshToken) return;
    await fetch(apiBase() + '/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: identity.refreshToken }),
    });
  } catch { /* the refresh row expires on its own */ }
}

export interface Me {
  displayName: string | null;
  handle: string | null;
}

export async function fetchMe(): Promise<Me | null> {
  const res = await authedFetch('/me');
  if (!res.ok) return null;
  return (await res.json()) as Me;
}

/**
 * Erase the account server-side - goals, check-ins, profile and the identity
 * links all go, plus this device's coach transcripts. Throws on failure so
 * the UI can say nothing was deleted; the caller signs out locally after.
 */
export async function deleteAccount(): Promise<void> {
  const res = await authedFetch('/me', { method: 'DELETE', headers: { 'X-Qleck-Device': getDeviceId() } });
  if (!res.ok) throw new Error(`delete_account_failed_${res.status}`);
}

/** Fire-and-forget friendly; throws on failure so callers may retry.
 *  A 409 means the handle was claimed between the availability check and
 *  this save — the profile keeps its name, the handle stays unset. */
/**
 * Update the parts of your profile the server owns.
 *
 * BLANK FIELDS ARE OMITTED, not sent. The endpoint writes with
 * COALESCE(?, existing), so a field it receives as an empty string is a field
 * it sets to empty — passing `''` for a handle silently WIPED it. Reachable
 * today: Apple hands over a full name exactly once, so a returning Apple user
 * whose name arrives with no username called this as saveMe(name, '').
 */
export async function saveMe(displayName?: string, handle?: string): Promise<void> {
  const body: Record<string, string> = {};
  if (displayName?.trim()) body.displayName = displayName.trim();
  if (handle?.trim()) body.handle = handle.trim();
  if (Object.keys(body).length === 0) return;
  const res = await authedFetch('/me', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`save_me_failed_${res.status}`);
}


/** P5: everything we hold about you, as JSON. Returns the document itself so
 *  the caller can hand it to a share sheet or a download. */
export async function exportMyData(): Promise<string> {
  const res = await authedFetch('/me/export');
  if (!res.ok) throw new Error(`export_failed_${res.status}`);
  return res.text();
}