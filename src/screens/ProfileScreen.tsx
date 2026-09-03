// You tab — identity, current goal, settings. Trimmed to the coach-first
// shape (owner call, 2026-08-24): the mock badges/friends/crews/stat rows came
// off; real community (friends, cheers, doing goals together) returns via
// ROADMAP P6 on a real backend.
import React, { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { deleteAccount, exportMyData, saveMe } from '../api/account';
import Constants from 'expo-constants';
import { clearAccountHint, getStoredIdentity } from '../api/device';
import {
  ensureNudgePermission, fmtTime, getNudgePermission, loadNudgePrefs, saveNudgePrefs,
  type NudgePermission, type NudgePrefs,
} from '../lib/nudges';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, Share, Switch, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FadeInUp from '../components/FadeInUp';
import SectionLabel from '../components/SectionLabel';
import YouAvatar from '../components/YouAvatar';
import { goalTitle } from '../components/protocolViews';
import { useRally } from '../state/RallyContext';
import { useTheme, type ThemePref } from '../state/ThemeContext';
import type { LogoutOpts } from '../../App';
import { colors, fonts, radii } from '../theme';

// "Notifications" used to live here as a chevron that did nothing. It comes
// back with the feature (ROADMAP P4: local nudges, quiet hours, per-goal mute)
// — a control over something that doesn't exist is worse than no control.

const APPEARANCE: { key: ThemePref; label: string }[] = [
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
  { key: 'system', label: 'System' },
];

// One switch for the whole product: the tabs and the Qoach surfaces always
// share a mode, so moving between them never changes the lighting.
function AppearanceRow() {
  const { pref, setPref } = useTheme();
  return (
    <View style={{ paddingVertical: 14, paddingHorizontal: 16 }}>
      <Text style={{ fontSize: 14, fontFamily: fonts.semibold, color: colors.ink, marginBottom: 10 }}>
        Appearance
      </Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {APPEARANCE.map(opt => {
          const on = pref === opt.key;
          return (
            <Pressable
              key={opt.key}
              onPress={() => setPref(opt.key)}
              style={{
                flex: 1, height: 40, borderRadius: radii.pill,
                alignItems: 'center', justifyContent: 'center',
                backgroundColor: on ? colors.ink : 'transparent',
                borderWidth: 1.5, borderColor: on ? colors.ink : colors.inputBorder,
              }}
            >
              <Text
                style={{
                  fontSize: 13, fontFamily: fonts.bold,
                  color: on ? colors.bg : colors.muted,
                }}
              >
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        marginHorizontal: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
        borderRadius: radii.card, overflow: 'hidden',
        shadowColor: colors.shadow, shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 2 },
      }}
    >
      {children}
    </View>
  );
}

/* ── P4 nudges: master switch, the two times, per-goal mute ──────────────
   The manager (NudgeManager) reschedules the moment anything here saves;
   times step in 30-minute clicks because a time-picker per platform is a
   worse trade than two arrows. */
function NudgesCard({ goals }: { goals: { id: string; statement: string; protocol: { short_title?: string } }[] }) {
  const [prefs, setPrefs] = useState<NudgePrefs | null>(null);
  const [permission, setPermission] = useState<NudgePermission>('undetermined');
  useEffect(() => {
    loadNudgePrefs().then(setPrefs);
    getNudgePermission().then(setPermission);
  }, []);

  if (Platform.OS === 'web') {
    return (
      <Card>
        <View style={{ paddingVertical: 15, paddingHorizontal: 16 }}>
          <Text style={{ fontSize: 13, fontFamily: fonts.semibold, color: colors.muted, lineHeight: 19 }}>
            Nudges are a phone thing — the morning rep note and the evening streak save arrive on iOS and Android.
          </Text>
        </View>
      </Card>
    );
  }
  if (!prefs) return <Card><View style={{ height: 52 }} /></Card>;

  const save = (next: NudgePrefs) => { setPrefs(next); void saveNudgePrefs(next); };
  const toggleMaster = async (on: boolean) => {
    save({ ...prefs, enabled: on });
    if (on) setPermission(await ensureNudgePermission());
  };
  const step = (key: 'morning' | 'evening', delta: number) => {
    const [lo, hi] = key === 'morning' ? [5 * 60, 13 * 60] : [16 * 60, 23 * 60 + 30];
    save({ ...prefs, [key]: Math.max(lo, Math.min(hi, prefs[key] + delta)) });
  };
  const toggleMute = (id: string, nudging: boolean) => {
    save({ ...prefs, muted: nudging ? prefs.muted.filter(m => m !== id) : [...prefs.muted, id] });
  };

  const timeRow = (label: string, key: 'morning' | 'evening') => (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: colors.hairline }}>
      <Text style={{ flex: 1, fontSize: 13.5, fontFamily: fonts.semibold, color: colors.ink }}>{label}</Text>
      <Pressable onPress={() => step(key, -30)} hitSlop={8} style={{ width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, borderColor: colors.outline, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 15, fontFamily: fonts.bold, color: colors.ink }}>−</Text>
      </Pressable>
      <Text style={{ width: 78, textAlign: 'center', fontSize: 13.5, fontFamily: fonts.extrabold, color: colors.ink }}>{fmtTime(prefs[key])}</Text>
      <Pressable onPress={() => step(key, 30)} hitSlop={8} style={{ width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, borderColor: colors.outline, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 15, fontFamily: fonts.bold, color: colors.ink }}>+</Text>
      </Pressable>
    </View>
  );

  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 16 }}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={{ fontSize: 14, fontFamily: fonts.semibold, color: colors.ink }}>Daily nudges</Text>
          <Text style={{ fontSize: 11.5, fontFamily: fonts.regular, color: colors.muted, marginTop: 2, lineHeight: 16 }}>
            A morning rep note and an evening streak save. Rest days stay silent.
          </Text>
        </View>
        <Switch value={prefs.enabled} onValueChange={v => { void toggleMaster(v); }} />
      </View>
      {prefs.enabled && (
        <>
          {timeRow('Morning nudge', 'morning')}
          {timeRow('Evening nudge', 'evening')}
          {goals.length > 1 && goals.map(g => {
            const nudging = !prefs.muted.includes(g.id);
            return (
              <View key={g.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: colors.hairline }}>
                <Text numberOfLines={1} style={{ flex: 1, paddingRight: 12, fontSize: 13, fontFamily: fonts.semibold, color: nudging ? colors.ink : colors.muted }}>
                  {goalTitle(g.statement, g.protocol)}
                </Text>
                <Switch value={nudging} onValueChange={v => toggleMute(g.id, v)} />
              </View>
            );
          })}
          {permission === 'denied' && (
            <View style={{ paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: colors.hairline }}>
              <Text style={{ fontSize: 12, fontFamily: fonts.semibold, color: colors.muted, lineHeight: 17 }}>
                Notifications are switched off for Qleck in your phone's Settings.
              </Text>
              <Pressable onPress={() => { void Linking.openSettings(); }} hitSlop={6} style={{ marginTop: 4 }}>
                <Text style={{ fontSize: 12.5, fontFamily: fonts.bold, color: colors.accentLink, textDecorationLine: 'underline' }}>
                  Open Settings
                </Text>
              </Pressable>
            </View>
          )}
        </>
      )}
    </Card>
  );
}

export default function ProfileScreen({ onLogout }: { onLogout: (opts?: LogoutOpts) => void }) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { profile, goals } = useRally();

  return (
    <FadeInUp style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={{ paddingTop: Math.max(insets.top, 58) + 12, paddingBottom: 130 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ alignItems: 'center', paddingTop: 18, paddingHorizontal: 20 }}>
          <YouAvatar size={84} fontSize={30} serif />
          <NameRow />
          <Text style={{ fontSize: 12.5, fontFamily: fonts.semibold, color: colors.muted, marginTop: 4 }}>
            @{profile.handle}
          </Text>
        </View>

        <SectionLabel style={{ marginTop: 22 }}>{goals.length > 1 ? 'CURRENT GOALS' : 'CURRENT GOAL'}</SectionLabel>
        <Card>
          {goals.length === 0 ? (
            <View style={{ paddingVertical: 15, paddingHorizontal: 16 }}>
              <Text style={{ fontSize: 13, fontFamily: fonts.semibold, color: colors.muted }}>
                No goal yet — tap + to talk to Qoach.
              </Text>
            </View>
          ) : (
            goals.map((goal, i) => (
              <View
                key={goal.id}
                style={{
                  paddingVertical: 15, paddingHorizontal: 16,
                  borderBottomWidth: i < goals.length - 1 ? 1 : 0, borderBottomColor: colors.hairline,
                }}
              >
                <Text style={{ fontSize: 14.5, fontFamily: fonts.extrabold, color: colors.ink }}>
                  {goalTitle(goal.statement, goal.protocol)}
                </Text>
                <Text style={{ fontSize: 11.5, fontFamily: fonts.semibold, color: colors.muted, marginTop: 3 }}>
                  {goal.durationWeeks} weeks · coached by Qoach
                </Text>
              </View>
            ))
          )}
        </Card>

        <SectionLabel>NUDGES</SectionLabel>
        <NudgesCard goals={goals} />

        <SectionLabel>SETTINGS</SectionLabel>
        <Card>
          <AppearanceRow />
          <View style={{ height: 1, backgroundColor: colors.hairline }} />
          <Pressable
            onPress={() => navigation.navigate('Help')}
            style={({ pressed }) => ({
              flexDirection: 'row', alignItems: 'center', paddingVertical: 15, paddingHorizontal: 16,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text style={{ flex: 1, fontSize: 14, fontFamily: fonts.semibold, color: colors.ink }}>
              Help &amp; about
            </Text>
            <Text style={{ fontSize: 16, color: colors.chevron }}>›</Text>
          </Pressable>
        </Card>

        <ExportDataRow />
        <LogOutRow onLogout={onLogout} goalCount={goals.length} />
        <DeleteAccountRow onDone={() => onLogout({ fresh: true })} />
        <VersionRow onLogout={onLogout} />
      </ScrollView>
    </FadeInUp>
  );
}


/**
 * Logging out clears this device's identity, which is the only account that
 * exists until real sign-in lands (ROADMAP P3). The goals stay on the server
 * but nothing can reach them again, so this asks first and says exactly what
 * goes. Alert.alert is deliberately avoided — it is a no-op on web, which is
 * where the beta testers are.
 */
/**
 * P5: take your data with you. The counterpart to Delete — a store and GDPR
 * expectation, and the honest answer to "what do you actually have on me".
 */
function ExportDataRow() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const json = await exportMyData();
      if (Platform.OS === 'web') {
        // A real download, not a copy-paste: this is their file.
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = 'qleck-export.json';
        a.click();
        URL.revokeObjectURL(url);
        setDone('Downloaded.');
      } else {
        await Share.share({ message: json });
        setDone('Sent.');
      }
    } catch {
      setDone("Couldn't build it — try again in a moment.");
    } finally {
      setBusy(false);
      setTimeout(() => setDone(''), 4000);
    }
  };
  return (
    <Pressable
      onPress={run}
      style={{
        marginTop: 22, marginHorizontal: 14, minHeight: 52, borderRadius: radii.pill,
        borderWidth: 1.5, borderColor: colors.outline, paddingHorizontal: 18,
        alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.6 : 1,
      }}
    >
      <Text style={{ fontSize: 14, fontFamily: fonts.bold, color: colors.ink }}>
        {busy ? 'Gathering your data…' : done || 'Download my data'}
      </Text>
    </Pressable>
  );
}

/**
 * The version line, and behind seven taps the way back to a factory-fresh
 * device.
 *
 * On iOS the identity lives in SecureStore — the Keychain — which SURVIVES
 * deleting the app. So "uninstall and reinstall" does not return you to the
 * first-run screens, and until this there was no way to reach them at all on
 * a device that had ever signed in. That makes the welcome funnel untestable
 * on the one device it matters on.
 *
 * Seven taps because this is a testing affordance, not a feature. A visible
 * row here would sit beside Log out and Delete account and read like a third
 * way to lose your data — it is not one, but the shape of the list would say
 * otherwise. Hidden, it costs nobody anything and is always there when it is
 * needed.
 */
function VersionRow({ onLogout }: { onLogout: (opts?: LogoutOpts) => void }) {
  const { signOut } = useRally();
  const [taps, setTaps] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  // nativeBuildVersion is the CFBundleVersion actually in the installed app —
  // app.json's buildNumber is only what the last commit INTENDED to ship, and
  // those have disagreed before. On web neither exists, hence the fallbacks.
  const version = Constants.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '1.0.0';
  const build = Constants.nativeBuildVersion ?? Constants.expoConfig?.ios?.buildNumber ?? 'web';

  const reset = async () => {
    if (busy) return;
    setBusy(true);
    // signOut already revokes the session server-side and clears the identity,
    // the goals, the profile and the outboxes. What it deliberately keeps is
    // the knowledge that this device HAD an account — which is exactly what a
    // factory reset has to forget, or the next launch opens on a sign-in door
    // instead of the funnel.
    try { await signOut(); } catch { /* best effort — still reset locally */ }
    await clearAccountHint().catch(() => {});
    await AsyncStorage.multiRemove([
      'qleck-milestones-seen', 'qleck-witness-offered',
    ]).catch(() => {});
    onLogout({ fresh: true });
  };

  return (
    <View style={{ marginTop: 26, marginBottom: 8, alignItems: 'center' }}>
      <Pressable onPress={() => setTaps(n => n + 1)} hitSlop={10}>
        <Text style={{ fontFamily: fonts.semibold, fontSize: 11.5, color: colors.sectionLabel }}>
          Qleck v{version} ({build})
        </Text>
      </Pressable>

      {taps >= 7 ? (
        <View
          style={{
            marginTop: 14, marginHorizontal: 14, alignSelf: 'stretch', padding: 16,
            borderRadius: radii.card, borderWidth: 1, borderColor: colors.border,
            backgroundColor: colors.card,
          }}
        >
          <Text style={{ fontFamily: fonts.extrabold, fontSize: 13, color: colors.ink }}>
            Reset this device
          </Text>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 12, lineHeight: 18, color: colors.muted, marginTop: 6 }}>
            Forgets this device&apos;s sign-in and everything cached on it, so the app
            opens on the first-run screens like a new install. Your account and your
            goals stay on the server — sign back in and they return.
          </Text>
          {confirming ? (
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <Pressable
                onPress={() => setConfirming(false)}
                style={{ flex: 1, height: 44, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.outline, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ fontFamily: fonts.bold, fontSize: 13, color: colors.ink }}>Keep it</Text>
              </Pressable>
              <Pressable
                onPress={reset}
                style={{ flex: 1, height: 44, borderRadius: radii.pill, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.6 : 1 }}
              >
                <Text style={{ fontFamily: fonts.bold, fontSize: 13, color: colors.creamText }}>
                  {busy ? 'Resetting…' : 'Reset'}
                </Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={() => setConfirming(true)}
              style={{ marginTop: 14, height: 44, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.dangerBorder, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ fontFamily: fonts.bold, fontSize: 13, color: colors.danger }}>Reset this device</Text>
            </Pressable>
          )}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Your name, and the way to fix it.
 *
 * It was collected once during onboarding and never editable again, so a typo
 * on the signup screen was permanent — and an account created by a route that
 * collects no name at all (Sign in with Apple, the review door) was stuck
 * showing the seeded default forever.
 *
 * Name only. The handle is unique server-side and a rename there needs an
 * availability check and a 409 path, which is its own change; this is the
 * field people actually get wrong.
 */
function NameRow() {
  const { profile, syncAccount } = useRally();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(profile.fullName);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const open = () => { setDraft(profile.fullName); setErr(''); setEditing(true); };

  const save = async () => {
    const next = draft.trim();
    if (busy) return;
    if (!next) { setErr('A name, however short.'); return; }
    if (next === profile.fullName) { setEditing(false); return; }
    setBusy(true);
    setErr('');
    try {
      await saveMe(next);
      // Re-read rather than patching local state: the server is what the next
      // launch will show, so this proves the save landed instead of assuming
      // it. syncAccount also re-derives the avatar's initials.
      await syncAccount();
      setEditing(false);
    } catch {
      setErr("Couldn't save that — try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <Pressable onPress={open} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 12 }}>
        <Text style={{ fontFamily: fonts.serif, fontSize: 23, color: colors.ink }}>{profile.fullName}</Text>
        <Text style={{ fontFamily: fonts.semibold, fontSize: 12, color: colors.muted }}>Edit</Text>
      </Pressable>
    );
  }

  return (
    <View style={{ alignSelf: 'stretch', marginTop: 12, gap: 10 }}>
      <TextInput
        value={draft}
        onChangeText={t => { setDraft(t); setErr(''); }}
        autoFocus
        maxLength={80}
        returnKeyType="done"
        onSubmitEditing={save}
        placeholder="Your name"
        placeholderTextColor={colors.muted}
        style={{
          height: 50, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.outline,
          paddingHorizontal: 18, textAlign: 'center',
          fontFamily: fonts.serif, fontSize: 19, color: colors.ink,
        }}
      />
      {err ? (
        <Text style={{ textAlign: 'center', fontFamily: fonts.semibold, fontSize: 12, color: colors.danger }}>{err}</Text>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Pressable
          onPress={() => setEditing(false)}
          style={{ flex: 1, height: 44, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.outline, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ fontFamily: fonts.bold, fontSize: 13, color: colors.ink }}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={save}
          style={{ flex: 1, height: 44, borderRadius: radii.pill, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.6 : 1 }}
        >
          {busy ? <ActivityIndicator size="small" color={colors.creamText} />
                : <Text style={{ fontFamily: fonts.bold, fontSize: 13, color: colors.creamText }}>Save</Text>}
        </Pressable>
      </View>
    </View>
  );
}

function LogOutRow({ onLogout, goalCount }: { onLogout: (opts?: LogoutOpts) => void; goalCount: number }) {
  const { signOut } = useRally();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  // An account-backed identity (Apple or email, P3) makes logout recoverable;
  // anonymous stays a one-way door and the copy has to say so. Read through
  // getStoredIdentity — the identity lives in SecureStore on native now.
  const [accountProvider, setAccountProvider] = useState<'apple' | 'email' | null>(null);
  const isAccount = accountProvider !== null;
  useEffect(() => {
    getStoredIdentity()
      .then(identity => setAccountProvider(identity?.provider ?? null))
      .catch(() => {});
  }, [confirming]);

  const doLogOut = async () => {
    if (busy) return;
    setBusy(true);
    try { await signOut(); } catch { /* clearing is best-effort; still log out */ }
    // Hand the provider up: signOut() has just wiped the identity, so this is
    // the last moment anything knows which door to send them back to.
    onLogout({ provider: accountProvider });
  };

  if (!confirming) {
    return (
      <Pressable
        onPress={() => setConfirming(true)}
        style={{
          marginTop: 22, marginHorizontal: 14, height: 52, borderRadius: radii.pill,
          borderWidth: 1.5, borderColor: colors.dangerBorder,
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: 14, fontFamily: fonts.bold, color: colors.danger }}>Log out</Text>
      </Pressable>
    );
  }

  return (
    <View style={{
      marginTop: 22, marginHorizontal: 14, padding: 16, borderRadius: radii.card,
      borderWidth: 1.5, borderColor: colors.dangerBorder, gap: 12,
    }}>
      <Text style={{ fontSize: 15, fontFamily: fonts.bold, color: colors.ink }}>Log out?</Text>
      <Text style={{ fontSize: 13, lineHeight: 19, fontFamily: fonts.regular, color: colors.inkSoft }}>
        {isAccount
          ? accountProvider === 'apple'
            ? 'Your goals are saved to your Apple account — sign back in with Apple any time and they come right back.'
            : 'Your goals are saved to your account — log back in with your email any time and they come right back.'
          : goalCount > 0
            ? `This clears this device, so your ${goalCount} ${goalCount === 1 ? 'goal' : 'goals'} and streak will be gone from the app. On this platform there's no sign-in yet, so there's no way to log back in and get them.`
            : 'This clears this device and starts you over from a blank slate.'}
      </Text>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Pressable
          onPress={() => setConfirming(false)}
          style={{
            flex: 1, height: 46, borderRadius: radii.pill, borderWidth: 1.5,
            borderColor: colors.outline, alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 14, fontFamily: fonts.bold, color: colors.ink }}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={doLogOut}
          style={{
            flex: 1, height: 46, borderRadius: radii.pill, backgroundColor: colors.danger,
            alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.6 : 1,
          }}
        >
          <Text style={{ fontSize: 14, fontFamily: fonts.bold, color: '#fff' }}>
            {busy ? 'Logging out…' : 'Log out'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}


/**
 * App Review 5.1.1(v): an app with accounts must let the user delete the
 * account in-app - and it should be true anyway. Same two-step confirm
 * pattern as LogOutRow (Alert.alert stays banned: no-op on web). The
 * server call goes first; only a confirmed erase clears local state, so a
 * network failure deletes nothing and says so.
 */
function DeleteAccountRow({ onDone }: { onDone: () => void }) {
  const { signOut } = useRally();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const doDelete = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await deleteAccount();
    } catch {
      setBusy(false);
      setFailed(true);
      return;
    }
    try { await signOut(); } catch { /* server side is gone; local clear is best-effort */ }
    onDone();
  };

  if (!confirming) {
    return (
      <Pressable onPress={() => setConfirming(true)} style={{ marginTop: 12, marginHorizontal: 14, height: 44, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 13, fontFamily: fonts.semibold, color: colors.inkFaint }}>Delete account</Text>
      </Pressable>
    );
  }

  return (
    <View style={{
      marginTop: 12, marginHorizontal: 14, padding: 16, borderRadius: radii.card,
      borderWidth: 1.5, borderColor: colors.dangerBorder, gap: 12,
    }}>
      <Text style={{ fontSize: 15, fontFamily: fonts.bold, color: colors.danger }}>Delete your account?</Text>
      <Text style={{ fontSize: 13, lineHeight: 19, fontFamily: fonts.regular, color: colors.inkSoft }}>
        This permanently erases your account and everything in it - goals, streaks, check-ins and your
        profile - from Qleck's servers. There is no undo, and signing back in starts from nothing.
      </Text>
      {failed ? (
        <Text style={{ fontSize: 12, fontFamily: fonts.semibold, color: colors.danger }}>
          Couldn't reach the server - nothing was deleted. Try again in a moment.
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Pressable
          onPress={() => { setConfirming(false); setFailed(false); }}
          style={{
            flex: 1, height: 46, borderRadius: radii.pill, borderWidth: 1.5,
            borderColor: colors.outline, alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 14, fontFamily: fonts.bold, color: colors.ink }}>Keep my account</Text>
        </Pressable>
        <Pressable
          onPress={doDelete}
          style={{
            flex: 1, height: 46, borderRadius: radii.pill, backgroundColor: colors.danger,
            alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.6 : 1,
          }}
        >
          <Text style={{ fontSize: 14, fontFamily: fonts.bold, color: '#fff' }}>
            {busy ? 'Deleting...' : 'Delete forever'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
