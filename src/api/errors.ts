// Crash/error reporting (P3): the owner's proven pattern — caught client
// errors land in qleck-api's client_errors table (30-day retention). Thin by
// design: deduped, throttled, never throws, never blocks the UI.
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { apiBase, getStoredIdentity } from './device';

const recent = new Map<string, number>();
const THROTTLE_MS = 30_000;

export function reportClientError(message: string, stack?: string, context?: string): void {
  try {
    const msg = String(message ?? '').slice(0, 500).trim();
    if (!msg) return;
    const now = Date.now();
    const last = recent.get(msg) ?? 0;
    if (now - last < THROTTLE_MS) return;
    recent.set(msg, now);
    if (recent.size > 20) recent.delete(recent.keys().next().value as string);
    void (async () => {
      const identity = await getStoredIdentity();
      const build = Constants.expoConfig?.ios?.buildNumber ?? Constants.expoConfig?.version ?? '';
      await fetch(apiBase() + '/client-errors', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(identity ? { Authorization: `Bearer ${identity.token}` } : {}),
        },
        body: JSON.stringify({
          message: msg,
          stack: String(stack ?? '').slice(0, 4000) || undefined,
          context: String(context ?? '').slice(0, 500) || undefined,
          platform: Platform.OS,
          build: String(build).slice(0, 20),
        }),
      });
    })().catch(() => {});
  } catch { /* reporting must never hurt */ }
}

/** Install the global hooks once from App. Errors keep their default
 *  handling (red box in dev, crash in prod) — this only ADDS the report. */
export function installErrorReporting(): void {
  try {
    type GlobalHandler = (error: unknown, isFatal?: boolean) => void;
    const utils = (globalThis as { ErrorUtils?: { getGlobalHandler(): GlobalHandler; setGlobalHandler(h: GlobalHandler): void } }).ErrorUtils;
    if (utils) {
      const prior = utils.getGlobalHandler();
      utils.setGlobalHandler((error, isFatal) => {
        const e = error as { message?: string; stack?: string };
        reportClientError(e?.message ?? String(error), e?.stack, isFatal ? 'fatal' : 'caught');
        prior?.(error, isFatal);
      });
    } else if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.addEventListener('error', ev => reportClientError(ev.message, ev.error?.stack, 'window.onerror'));
      window.addEventListener('unhandledrejection', ev =>
        reportClientError(String((ev.reason as { message?: string })?.message ?? ev.reason), (ev.reason as { stack?: string })?.stack, 'unhandledrejection'));
    }
  } catch { /* reporting must never hurt */ }
}
