// Account surface (P3): Sign in with Apple + the profile that survives
// devices. The Apple identity IS the account — no passwords anywhere.
import { apiBase, getIdentity, type DeviceIdentity } from './device';
import { getDeviceId } from './coach';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface AppleAuthResult {
  userId: string;
  token: string;
  /** true = this Apple ID already had an account (login); false = the current
   *  anonymous device user was just promoted (its goals came along). */
  existing: boolean;
}

/**
 * Exchange an Apple identity token for an account identity. The current
 * anonymous Bearer rides along so a first sign-in PROMOTES this device's
 * user (goals kept) instead of starting empty; the server ignores it when
 * the Apple ID already has an account.
 */
export async function appleAuth(identityToken: string): Promise<AppleAuthResult> {
  const { token } = await getIdentity();
  const res = await fetch(apiBase() + '/auth/apple', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ identityToken }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `apple_auth_failed_${res.status}`);
  }
  const out = (await res.json()) as AppleAuthResult;
  if (!out.userId || !out.token) throw new Error('apple_auth_malformed');
  // Swap the stored identity to the account. Everything downstream (goals,
  // check-ins, /me) rides qleck-identity, so this one write is the login.
  const identity: DeviceIdentity = { userId: out.userId, token: out.token, provider: 'apple' };
  await AsyncStorage.setItem('qleck-identity', JSON.stringify(identity)).catch(() => {});
  const { adoptIdentity } = await import('./device');
  adoptIdentity(identity);
  return out;
}

export interface Me {
  displayName: string | null;
  handle: string | null;
}

export async function fetchMe(): Promise<Me | null> {
  const { token } = await getIdentity();
  const res = await fetch(apiBase() + '/me', { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  return (await res.json()) as Me;
}

/**
 * Erase the account server-side - goals, check-ins, profile and the Apple
 * link all go, plus this device's coach transcripts. Throws on failure so
 * the UI can say nothing was deleted; the caller signs out locally after.
 */
export async function deleteAccount(): Promise<void> {
  const { token } = await getIdentity();
  const res = await fetch(apiBase() + '/me', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}`, 'X-Qleck-Device': getDeviceId() },
  });
  if (!res.ok) throw new Error(`delete_account_failed_${res.status}`);
}

/** Fire-and-forget friendly; throws on failure so callers may retry. */
export async function saveMe(displayName: string, handle: string): Promise<void> {
  const { token } = await getIdentity();
  const res = await fetch(apiBase() + '/me', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ displayName, handle }),
  });
  if (!res.ok) throw new Error(`save_me_failed_${res.status}`);
}
