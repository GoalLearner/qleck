// One appearance setting for the whole product (owner call 2026-08-25). The
// app surfaces and the Qoach surfaces used to be permanently different rooms —
// cream tabs, dark coach. Now a single mode drives both palettes, so crossing
// between them never changes the lighting.
//
// Mechanism: applyPalette/applyNight rewrite the live token objects in place
// BEFORE the tree renders, and this provider's state change re-renders
// everything under it. Because every style in the app is inline, each screen
// reads the fresh values without knowing the theme exists.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { applyPalette, type ThemeMode } from '../theme';
import { applyNight } from '../onboarding/theme';

/** What the user picked. 'system' follows the OS appearance. */
export type ThemePref = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'qleck-theme';

interface ThemeState {
  pref: ThemePref;
  mode: ThemeMode;        // pref resolved against the OS
  setPref: (p: ThemePref) => void;
}

const Ctx = createContext<ThemeState | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [pref, setPrefState] = useState<ThemePref>('system');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then(v => { if (v === 'light' || v === 'dark' || v === 'system') setPrefState(v); })
      .catch(() => {})
      .finally(() => setHydrated(true));
  }, []);

  const mode: ThemeMode = pref === 'system' ? (system === 'dark' ? 'dark' : 'light') : pref;

  // Synchronous so children render with the right tokens on the SAME pass —
  // an effect here would paint one frame in the previous palette.
  applyPalette(mode);
  applyNight(mode);

  const setPref = useCallback((p: ThemePref) => {
    setPrefState(p);
    AsyncStorage.setItem(STORAGE_KEY, p).catch(() => {});
  }, []);

  const value = useMemo(() => ({ pref, mode, setPref }), [pref, mode, setPref]);

  // Keep the first paint off until the stored choice is known, so a dark-mode
  // user never sees a cream flash on launch.
  if (!hydrated) return null;

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTheme must be used inside ThemeProvider');
  return v;
}
