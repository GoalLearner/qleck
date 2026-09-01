import React, { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';

// Hold the brand splash (owner fix, build 11): keep it up while the app
// boots, and never less than ~1.4s total — it used to blink away.
const SPLASH_MIN_MS = 1400;
const SPLASH_T0 = Date.now();
SplashScreen.preventAutoHideAsync().catch(() => {});
// Fonts are vendored into assets/fonts rather than imported from the
// @expo-google-fonts packages. Expo emits a package-sourced asset under
// dist/assets/node_modules/..., and some static hosts (Netlify Drop among
// them) drop node_modules directories from an upload — every face then 404s,
// useFonts never resolves, and the app hangs on a blank loading screen with
// no error. Keeping the files in the repo keeps them out of that path.

import RallyTabBar from './src/components/RallyTabBar';
import GoalsScreen from './src/screens/GoalsScreen';
import HomeScreen from './src/screens/HomeScreen';
import AdjustPlanScreen from './src/screens/AdjustPlanScreen';
import LedgerScreen from './src/screens/LedgerScreen';
import GraduationScreen from './src/screens/GraduationScreen';
import HelpScreen from './src/screens/HelpScreen';
import NewGoalScreen from './src/screens/NewGoalScreen';
import OnboardingFlow, { type OnbScreen } from './src/onboarding/OnboardingFlow';
import ProfileScreen from './src/screens/ProfileScreen';
import { fetchMe } from './src/api/account';
import { clearAccountHint, getStoredIdentity, hadAccount, onSessionRevoked } from './src/api/device';
import { installErrorReporting } from './src/api/errors';
import NudgeManager from './src/components/NudgeManager';
// Rally-era social surfaces (Plans/Streaks/Create/Friends/Event/Challenge
// screens) are quarantined out of the shell per the owner's coach-first call
// (2026-08-24); they return behind real backends per ROADMAP P6.
import { RallyProvider, useRally } from './src/state/RallyContext';
import { ThemeProvider, useTheme } from './src/state/ThemeContext';
import { colors } from './src/theme';

const Tab = createBottomTabNavigator();
const RootStack = createNativeStackNavigator();

// Built per render: colors.bg changes with the appearance setting, so a
// module-level constant would pin the navigator to whichever mode loaded first.
const navThemeFor = () => ({
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.bg },
});

// Lives inside RallyProvider so the funnel's result can land in app state
// before we flip to the tabs.
function Onboarding({ onDone, startScreen }: { onDone: () => void; startScreen?: OnbScreen }) {
  const { applyOnboarding } = useRally();
  return (
    <OnboardingFlow
      startScreen={startScreen}
      onAuthenticated={result => {
        applyOnboarding(result);
        onDone();
      }}
    />
  );
}

function Tabs({ onLogout }: { onLogout: () => void }) {
  return (
    <Tab.Navigator
      tabBar={props => <RallyTabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}
    >
      <Tab.Screen name="Today" component={HomeScreen} />
      <Tab.Screen name="Goals" component={GoalsScreen} />
      <Tab.Screen name="You">
        {() => <ProfileScreen onLogout={onLogout} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

function AppShell() {
  const { mode } = useTheme();
  // null = still reading the stored session flag.
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  // P3 mid-funnel resume: an account identity with no completed funnel means
  // the app died between verify and profile — pick up at the profile step. A
  // completed-then-logged-out account resumes at the login screen instead.
  const [resumeScreen, setResumeScreen] = useState<OnbScreen | undefined>(undefined);
  useEffect(() => {
    (async () => {
      const flag = await AsyncStorage.getItem('qleck-session').catch(() => null);
      if (flag === '1') { setLoggedIn(true); return; }
      try {
        const identity = await getStoredIdentity();
        if (identity?.provider) {
          const me = await fetchMe().catch(() => null);
          setResumeScreen(me && !me.displayName ? 'profile' : 'login');
        } else if (!identity && (await hadAccount())) {
          // The server ended this device's session (a password reset
          // elsewhere, a reuse revocation) and the identity is gone. An
          // account still exists though, so open at LOGIN rather than the
          // welcome funnel — the goals are all still there behind it.
          setResumeScreen('login');
        }
      } catch { /* fresh funnel from the top */ }
      setLoggedIn(false);
    })();
  }, []);
  const logIn = () => {
    setLoggedIn(true);
    setResumeScreen(undefined);
    AsyncStorage.setItem('qleck-session', '1').catch(() => {});
    void clearAccountHint();
  };
  const logOut = () => { setLoggedIn(false); setResumeScreen('login'); AsyncStorage.removeItem('qleck-session').catch(() => {}); };
  // A session the server ended mid-use drops straight to the login screen.
  // Without this the tabs stay mounted over a dead identity until the next
  // launch, every call 401ing behind them.
  useEffect(() => onSessionRevoked(() => { logOut(); }), []);
  // Keys are the family names every style refers to (src/theme.ts fonts.*),
  // so they must not be renamed.
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular: require('./assets/fonts/PlusJakartaSans_400Regular.ttf'),
    PlusJakartaSans_500Medium: require('./assets/fonts/PlusJakartaSans_500Medium.ttf'),
    PlusJakartaSans_600SemiBold: require('./assets/fonts/PlusJakartaSans_600SemiBold.ttf'),
    PlusJakartaSans_700Bold: require('./assets/fonts/PlusJakartaSans_700Bold.ttf'),
    PlusJakartaSans_800ExtraBold: require('./assets/fonts/PlusJakartaSans_800ExtraBold.ttf'),
    YoungSerif_400Regular: require('./assets/fonts/YoungSerif_400Regular.ttf'),
    // Onboarding ("Electric Night") type ramp.
    SpaceGrotesk_700Bold: require('./assets/fonts/SpaceGrotesk_700Bold.ttf'),
    DMSans_400Regular: require('./assets/fonts/DMSans_400Regular.ttf'),
    DMSans_500Medium: require('./assets/fonts/DMSans_500Medium.ttf'),
  });

  // Owner fix (build 11): the brand splash blinked away as soon as JS was
  // ready. Hold it for at least SPLASH_MIN_MS from launch — hideAsync fires
  // only once fonts + session state are ready AND the minimum has elapsed.
  useEffect(() => {
    if ((fontsLoaded || fontError) && loggedIn !== null) {
      const wait = Math.max(0, SPLASH_MIN_MS - (Date.now() - SPLASH_T0));
      const t = setTimeout(() => { SplashScreen.hideAsync().catch(() => {}); }, wait);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [fontsLoaded, fontError, loggedIn]);

  // Render anyway if a face fails to load. A missing font is a cosmetic
  // problem; a permanently blank screen is a broken app, and that is exactly
  // what this gate produced when the fonts 404'd on the first web deploy.
  if ((!fontsLoaded && !fontError) || loggedIn === null) {
    return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  }

  return (
    <SafeAreaProvider>
      <RallyProvider>
        {/* P4: keeps the pending nudge set mirroring goals + check-ins. */}
        <NudgeManager />
        <NavigationContainer theme={navThemeFor()}>
          {/* one appearance for every surface — the coach and the tabs agree */}
          <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
          <RootStack.Navigator screenOptions={{ headerShown: false }}>
            {!loggedIn ? (
              <RootStack.Screen name="Onboarding">
                {() => <Onboarding onDone={logIn} startScreen={resumeScreen} />}
              </RootStack.Screen>
            ) : (
              <>
                <RootStack.Screen name="Tabs">
                  {() => <Tabs onLogout={logOut} />}
                </RootStack.Screen>
                <RootStack.Screen name="NewGoal" component={NewGoalScreen} options={{ presentation: 'modal' }} />
                <RootStack.Screen name="Graduation" component={GraduationScreen} options={{ presentation: 'modal' }} />
                <RootStack.Screen name="Help" component={HelpScreen} options={{ presentation: 'modal' }} />
                <RootStack.Screen name="AdjustPlan" component={AdjustPlanScreen} options={{ presentation: 'modal' }} />
                <RootStack.Screen name="Ledger" component={LedgerScreen} options={{ presentation: 'modal' }} />
              </>
            )}
          </RootStack.Navigator>
        </NavigationContainer>
      </RallyProvider>
    </SafeAreaProvider>
  );
}

// P3 crash reporting: caught errors land in qleck-api's client_errors table.
// Installed once at module load so even provider-mount crashes report.
installErrorReporting();

export default function App() {
  // ThemeProvider is outermost: it rewrites the live palettes before anything
  // below it renders, so no surface ever paints a frame in the wrong mode.
  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  );
}
