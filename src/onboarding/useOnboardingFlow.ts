// The onboarding state machine, ported from the `DCLogic` class in the Claude
// Design canvas `Qleck Onboarding.dc.html`.
//
// Everything here is still the canvas' mock backend: the verification code is
// 424242, the password is qleck123, and sara@qleck.com is the seeded "account
// already exists" address. Phase 2 swaps these branches for the real
// magic-link / password API — the screens and copy stay put.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Protocol } from '../api/coachTypes';
import type { AcceptedPlan } from './useCoachFlow';

export const DEMO_CODE = '424242';
export const DEMO_PASSWORD = 'qleck123';
export const DEMO_EXISTING_EMAIL = 'sara@qleck.com';

export type OnbScreen =
  | 'welcome' | 'auth' | 'signup' | 'verify' | 'profile' | 'goal' | 'invite'
  | 'perms' | 'done' | 'login' | 'faceid' | 'forgot' | 'sent' | 'reset';

export type ContactMethod = 'email' | 'phone';
export type UnameStatus = 'idle' | 'checking' | 'taken' | 'free' | 'short';
export type ResetChannel = 'email' | 'sms';

export const SUGGESTED_FRIENDS = [
  { name: 'Maya Chen', handle: '@maya.moves', initial: 'M', grad: 1 },
  { name: 'Jonas Berg', handle: '@jonasb', initial: 'J', grad: 3 },
  { name: 'Priya Kaur', handle: '@priya.runs', initial: 'P', grad: 2 },
  { name: 'Sam Ortiz', handle: '@sam.o', initial: 'S', grad: 4 },
] as const;

const TAKEN_USERNAMES = ['sara', 'alex', 'runner', 'qleck', 'maya'];
const RESEND_SECONDS = 24;
const EMPTY_OTP = ['', '', '', '', '', ''];

/** What the funnel collected, handed to the app when onboarding completes. */
export interface OnboardingResult {
  name: string;
  username: string;
  avatar: number;
  contact: string;
  method: ContactMethod;
  goal: string | null;      // the accepted (possibly counter-offered) statement
  period: string | null;    // e.g. "6 weeks", from the verdict
  protocol: Protocol | null;
  invited: string[];
  allowNotifications: boolean;
  allowMotion: boolean;
}

export function useOnboardingFlow({
  startScreen = 'welcome',
  onAuthenticated,
}: {
  startScreen?: OnbScreen;
  onAuthenticated: (result: OnboardingResult) => void;
}) {
  const [screen, setScreen] = useState<OnbScreen>(startScreen);
  const [slide, setSlide] = useState(0);
  const [method, setMethod] = useState<ContactMethod>('email');
  const [contact, setContact] = useState('');
  const [contactErr, setContactErr] = useState('');
  const [existsOpen, setExistsOpen] = useState(false);
  const [otp, setOtp] = useState<string[]>(EMPTY_OTP);
  const [otpErr, setOtpErr] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [name, setName] = useState('');
  const [uname, setUname] = useState('');
  const [unameStatus, setUnameStatus] = useState<UnameStatus>('idle');
  const [avatar, setAvatar] = useState(0);
  // The accepted Qoach plan (statement + duration + protocol), set by the
  // coach flow on "Lock it in"; null when the user skipped.
  const [plan, setPlan] = useState<AcceptedPlan | null>(null);
  const [invited, setInvited] = useState<Record<number, boolean>>({});
  const [copied, setCopied] = useState(false);
  const [permNotif, setPermNotif] = useState(false);
  const [permSteps, setPermSteps] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPw, setLoginPw] = useState('');
  const [loginErr, setLoginErr] = useState(false);
  const [resetChannel, setResetChannel] = useState<ResetChannel>('email');
  const [resetPw1, setResetPw1] = useState('');
  const [resetPw2, setResetPw2] = useState('');
  const [resetErr, setResetErr] = useState('');
  const [toast, setToast] = useState('');

  const resendTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const faceIdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const otpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startResend = useCallback(() => {
    if (resendTimer.current) clearInterval(resendTimer.current);
    setResendIn(RESEND_SECONDS);
    resendTimer.current = setInterval(() => {
      setResendIn(v => {
        if (v <= 1) {
          if (resendTimer.current) clearInterval(resendTimer.current);
          return 0;
        }
        return v - 1;
      });
    }, 1000);
  }, []);

  // Snapshot of everything collected — read lazily so `nav` stays stable.
  const resultRef = useRef<OnboardingResult>({} as OnboardingResult);
  resultRef.current = {
    name: name.trim(),
    username: uname,
    avatar,
    contact: contact.trim() || loginEmail.trim(),
    method,
    goal: plan?.statement ?? null,
    period: plan ? `${plan.durationWeeks} weeks` : null,
    protocol: plan?.protocol ?? null,
    invited: Object.entries(invited).filter(([, on]) => on).map(([i]) => SUGGESTED_FRIENDS[Number(i)].name),
    allowNotifications: permNotif,
    allowMotion: permSteps,
  };

  const nav = useCallback((next: OnbScreen | 'home') => {
    // The canvas ends on a mock "day-one home" teaser; the real app hands off
    // to the actual Home tab instead.
    if (next === 'home') {
      onAuthenticated(resultRef.current);
      return;
    }
    setToast('');
    setScreen(next);
    if (next === 'verify' || next === 'sent') startResend();
    if (next === 'faceid') {
      if (faceIdTimer.current) clearTimeout(faceIdTimer.current);
      faceIdTimer.current = setTimeout(() => onAuthenticated(resultRef.current), 2100);
    }
  }, [onAuthenticated, startResend]);

  useEffect(() => () => {
    if (resendTimer.current) clearInterval(resendTimer.current);
    if (faceIdTimer.current) clearTimeout(faceIdTimer.current);
    if (unameTimer.current) clearTimeout(unameTimer.current);
    if (otpTimer.current) clearTimeout(otpTimer.current);
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  /* ── verification code ────────────────────────────────────────────────── */

  const setOtpDigit = useCallback((index: number, value: string, focusNext: (i: number) => void) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    setOtp(prev => {
      const next = prev.slice();
      next[index] = digit;
      const code = next.join('');
      if (code.length === 6) {
        if (code === DEMO_CODE) {
          if (otpTimer.current) clearTimeout(otpTimer.current);
          otpTimer.current = setTimeout(() => nav('profile'), 300);
        } else {
          setOtpErr(true);
          if (otpTimer.current) clearTimeout(otpTimer.current);
          otpTimer.current = setTimeout(() => { setOtp(EMPTY_OTP); focusNext(0); }, 700);
        }
      }
      return next;
    });
    setOtpErr(false);
    if (digit && index < 5) focusNext(index + 1);
  }, [nav]);

  /* ── username availability ────────────────────────────────────────────── */

  const checkUname = useCallback((value: string) => {
    if (unameTimer.current) clearTimeout(unameTimer.current);
    if (!value) { setUnameStatus('idle'); return; }
    setUnameStatus('checking');
    unameTimer.current = setTimeout(() => {
      setUnameStatus(TAKEN_USERNAMES.includes(value) ? 'taken' : value.length >= 3 ? 'free' : 'short');
    }, 450);
  }, []);

  const changeUname = useCallback((raw: string) => {
    const v = raw.toLowerCase().replace(/[^a-z0-9._]/g, '');
    setUname(v);
    checkUname(v);
  }, [checkUname]);

  /* ── derived ──────────────────────────────────────────────────────────── */

  const isEmail = method === 'email';
  const usernameFree = unameStatus === 'free';
  const profileReady = avatar > 0 && name.trim().length > 1 && usernameFree;

  const initials = useMemo(() => (
    name.trim()
      ? name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
      : 'YOU'
  ), [name]);

  const firstName = name.trim() ? name.trim().split(/\s+/)[0] : 'friend';

  const contactMasked = useMemo(() => {
    const c = contact.trim();
    if (!c) return isEmail ? 'your email' : 'your number';
    if (isEmail && c.includes('@')) {
      const [user, domain] = c.split('@');
      return (user[0] || '') + '•••@' + domain;
    }
    return '••• ' + c.replace(/\D/g, '').slice(-3);
  }, [contact, isEmail]);

  // Password strength, same three checks the canvas runs.
  const strength = useMemo(() => {
    if (!resetPw1) return 0;
    const score =
      (resetPw1.length >= 8 ? 1 : 0) +
      (/[A-Z]/.test(resetPw1) ? 1 : 0) +
      (/\d|\W/.test(resetPw1) ? 1 : 0);
    return Math.max(1, Math.min(3, score));
  }, [resetPw1]);

  const usernameSuggestions = useMemo(
    () => [uname + '.oslo', uname + '_runs', uname + '24'],
    [uname],
  );

  /* ── actions ──────────────────────────────────────────────────────────── */

  const pickMethod = useCallback((m: ContactMethod) => {
    setMethod(m);
    setContact('');
    setContactErr('');
    setToast('');
    setScreen('signup');
  }, []);

  const submitContact = useCallback(() => {
    const c = contact.trim();
    if (isEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c)) {
      setContactErr('That email looks off — one more try?');
      return;
    }
    if (!isEmail && c.replace(/\D/g, '').length < 8) {
      setContactErr('That number looks short — include your country code.');
      return;
    }
    if (isEmail && c.toLowerCase() === DEMO_EXISTING_EMAIL) {
      setExistsOpen(true);
      return;
    }
    nav('verify');
  }, [contact, isEmail, nav]);

  const socialJoin = useCallback(() => {
    setContact('sara@icloud.com');
    nav('profile');
  }, [nav]);

  const submitLogin = useCallback(() => {
    if (loginPw === DEMO_PASSWORD && loginEmail.trim().length > 3) nav('home');
    else setLoginErr(true);
  }, [loginEmail, loginPw, nav]);

  const saveReset = useCallback(() => {
    if (resetPw1.length < 8) {
      setResetErr('Needs 8+ characters — stretch it out.');
      return;
    }
    if (resetPw1 !== resetPw2) {
      setResetErr('Those two don’t match. One more go.');
      return;
    }
    setScreen('login');
    setLoginPw('');
    setLoginErr(false);
    setToast('Password updated — log in with the new one.');
  }, [resetPw1, resetPw2]);

  const copyLink = useCallback(() => {
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1800);
  }, []);

  return {
    // screen + navigation
    screen, nav,
    // welcome carousel
    slide, setSlide,
    welcomeNext: () => (slide < 2 ? setSlide(slide + 1) : nav('auth')),
    // signup
    method, isEmail, pickMethod, socialJoin,
    contact, setContact: (v: string) => { setContact(v); setContactErr(''); },
    contactErr, submitContact, contactMasked,
    existsOpen, setExistsOpen,
    existsLogin: () => { setExistsOpen(false); setLoginEmail(DEMO_EXISTING_EMAIL); nav('login'); },
    existsReset: () => { setExistsOpen(false); nav('forgot'); },
    // verify
    otp, otpErr, setOtpDigit, resendIn, startResend,
    // profile
    name, setName, initials, firstName,
    uname, changeUname, unameStatus, usernameFree, usernameSuggestions,
    avatar, cycleAvatar: () => setAvatar(a => (a % 3) + 1),
    profileReady,
    // first goal
    plan, setPlan,
    // invite
    invited, toggleInvite: (i: number) => setInvited(prev => ({ ...prev, [i]: !prev[i] })),
    copied, copyLink,
    // permissions
    permNotif, togglePermNotif: () => setPermNotif(v => !v),
    permSteps, togglePermSteps: () => setPermSteps(v => !v),
    // login
    loginEmail, setLoginEmail: (v: string) => { setLoginEmail(v); setLoginErr(false); },
    loginPw, setLoginPw: (v: string) => { setLoginPw(v); setLoginErr(false); },
    loginErr, submitLogin,
    // recovery
    resetChannel, setResetChannel,
    resetPw1, setResetPw1: (v: string) => { setResetPw1(v); setResetErr(''); },
    resetPw2, setResetPw2: (v: string) => { setResetPw2(v); setResetErr(''); },
    resetErr, strength, saveReset,
    // toast
    toast,
  };
}

export type OnboardingFlow = ReturnType<typeof useOnboardingFlow>;
