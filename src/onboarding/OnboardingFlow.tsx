// Qleck onboarding — the "Electric Night" funnel from the Claude Design canvas
// `Qleck Onboarding.dc.html` (project 7091d355), ported to React Native.
//
// Three journeys share one state machine:
//   sign up   welcome → auth → signup → verify → profile → goal → invite → perms → done
//   log in    login → (Face ID) → app
//   recovery  forgot → sent → reset → login
//
// The canvas' scaffolding is deliberately not ported: the iOS device frame and
// the "flow map" rail are mockup chrome, and its terminal "day-one home" teaser
// is replaced by a real hand-off into the app (`onAuthenticated`).
import React, { useEffect } from 'react';
import { BackHandler, Platform, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { night, nightFonts } from './theme';
import { Pop } from './ui';
import {
  useOnboardingFlow, type OnbScreen, type OnboardingResult,
} from './useOnboardingFlow';
import AuthScreen from './screens/AuthScreen';
import DoneScreen from './screens/DoneScreen';
import FaceIdScreen from './screens/FaceIdScreen';
import FirstGoalScreen from './screens/FirstGoalScreen';
import ForgotPasswordScreen from './screens/ForgotPasswordScreen';
import InviteScreen from './screens/InviteScreen';
import LinkSentScreen from './screens/LinkSentScreen';
import NewPasswordScreen from './screens/NewPasswordScreen';
import PermissionsScreen from './screens/PermissionsScreen';
import ProfileSetupScreen from './screens/ProfileSetupScreen';
import SignInScreen from './screens/SignInScreen';
import SignupScreen from './screens/SignupScreen';
import VerifyScreen from './screens/VerifyScreen';
import WelcomeScreen from './screens/WelcomeScreen';

// Where the on-screen back affordance goes, mirrored for Android's back gesture.
const BACK_TARGET: Partial<Record<OnbScreen, OnbScreen>> = {
  auth: 'welcome',
  signup: 'auth',
  verify: 'signup',
  login: 'welcome',
  forgot: 'login',
  sent: 'forgot',
};

function Toast({ message }: { message: string }) {
  const insets = useSafeAreaInsets();
  return (
    <Pop
      duration={350}
      style={{
        position: 'absolute', top: Math.max(insets.top, 24) + 16, left: 20, right: 20, zIndex: 40,
      }}
    >
      <View
        style={{
          backgroundColor: 'rgba(43,227,128,0.16)', borderWidth: 1, borderColor: night.accentBorder,
          borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12,
        }}
      >
        <Text style={{ fontFamily: nightFonts.bodyMedium, fontSize: 13, color: night.accentText }}>
          {message}
        </Text>
      </View>
    </Pop>
  );
}

export default function OnboardingFlow({
  onAuthenticated,
  startScreen = 'welcome',
  // The canvas ships tap-through affordances (prefilled demo addresses, the
  // 424242 hint, the qleck123 hint). They stay until Phase 2's real backend.
  demoHints = true,
}: {
  onAuthenticated: (result: OnboardingResult) => void;
  startScreen?: OnbScreen;
  demoHints?: boolean;
}) {
  const flow = useOnboardingFlow({ startScreen, onAuthenticated });
  const { screen, nav } = flow;

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (flow.existsOpen) { flow.setExistsOpen(false); return true; }
      const target = BACK_TARGET[screen];
      if (target) { nav(target); return true; }
      return screen !== 'welcome';
    });
    return () => sub.remove();
  }, [flow, nav, screen]);

  return (
    <View style={{ flex: 1, backgroundColor: night.bg }}>
      <StatusBar style="light" />
      {!!flow.toast && <Toast message={flow.toast} />}

      {screen === 'welcome' && <WelcomeScreen flow={flow} />}
      {screen === 'auth' && <AuthScreen flow={flow} />}
      {screen === 'signup' && <SignupScreen flow={flow} demoHints={demoHints} />}
      {screen === 'verify' && <VerifyScreen flow={flow} demoHints={demoHints} />}
      {screen === 'profile' && <ProfileSetupScreen flow={flow} />}
      {screen === 'goal' && (
        <FirstGoalScreen
          demoHints={demoHints}
          onLocked={plan => { flow.setPlan(plan); flow.nav('invite'); }}
          onDismiss={() => flow.nav('invite')}
        />
      )}
      {screen === 'invite' && <InviteScreen flow={flow} />}
      {screen === 'perms' && <PermissionsScreen flow={flow} />}
      {screen === 'done' && <DoneScreen flow={flow} demoHints={demoHints} />}
      {screen === 'login' && <SignInScreen flow={flow} demoHints={demoHints} />}
      {screen === 'faceid' && <FaceIdScreen />}
      {screen === 'forgot' && <ForgotPasswordScreen flow={flow} />}
      {screen === 'sent' && <LinkSentScreen flow={flow} />}
      {screen === 'reset' && <NewPasswordScreen flow={flow} />}
    </View>
  );
}

export type { OnboardingResult, OnbScreen };
