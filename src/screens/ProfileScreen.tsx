// You tab — identity, current goal, settings. Trimmed to the coach-first
// shape (owner call, 2026-08-24): the mock badges/friends/crews/stat rows came
// off; real community (friends, cheers, doing goals together) returns via
// ROADMAP P6 on a real backend.
import React, { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { deleteAccount } from '../api/account';
import { getStoredIdentity } from '../api/device';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FadeInUp from '../components/FadeInUp';
import SectionLabel from '../components/SectionLabel';
import YouAvatar from '../components/YouAvatar';
import { goalTitle } from '../components/protocolViews';
import { useRally } from '../state/RallyContext';
import { useTheme, type ThemePref } from '../state/ThemeContext';
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

export default function ProfileScreen({ onLogout }: { onLogout: () => void }) {
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
          <Text style={{ fontFamily: fonts.serif, fontSize: 23, marginTop: 12, color: colors.ink }}>
            {profile.fullName}
          </Text>
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

        <LogOutRow onLogout={onLogout} goalCount={goals.length} />
        <DeleteAccountRow onDone={onLogout} />
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
function LogOutRow({ onLogout, goalCount }: { onLogout: () => void; goalCount: number }) {
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
    onLogout();
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
