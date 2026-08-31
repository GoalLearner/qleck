// The onboarding state machine, ported from the `DCLogic` class in the Claude
// Design canvas `Qleck Onboarding.dc.html`.
//
// P3: the canvas' mock backend (424242 / qleck123 / sara@qleck.com /
// TAKEN_USERNAMES) is GONE — every branch talks to qleck-api. The screens
// and copy stay; each action gained a busy flag and an honest error state.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import {
  appleAuth, checkUsername, loginWithPassword, setPassword, startEmailCode, verifyEmailCode,
} from '../api/account';
import type { Protocol } from '../api/coachTypes';
import type { AcceptedPlan } from './useCoachFlow';

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

const RESEND_SECONDS = 24;
const EMPTY_OTP = ['', '', '', '', '', ''];
const OFFLINE_ERR = 'Couldn’t reach Qleck — check your connection and try again.';

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
  // P3 async states: one busy flag per action, honest error copy per screen.
  const [contactBusy, setContactBusy] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [otpErrMsg, setOtpErrMsg] = useState('');
  // Which flow the verify screen is serving — signup promotes; reset holds
  // its session aside for password/set and never adopts it.
  const [otpPurpose, setOtpPurpose] = useState<'signup' | 'reset'>('signup');
  const [loginBusy, setLoginBusy] = useState(false);
  const [resetEmail, setResetEmailRaw] = useState('');
  const [forgotErr, setForgotErr] = useState('');
  const [forgotBusy, setForgotBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const resetToken = useRef<string | null>(null);

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

  /* ── Sign in with Apple (iOS — the real account) ────────────────────
   * The only async in this hook. Native-only: web keeps the anonymous flow.
   * A first sign-in PROMOTES the device's anonymous user (goals kept) and
   * continues to profile setup; an existing account skips straight home —
   * its profile hydrates from /me.
   */
  const [appleBusy, setAppleBusy] = useState(false);
  const [appleErr, setAppleErr] = useState('');
  const appleSignIn = useCallback(async () => {
    if (appleBusy || Platform.OS !== 'ios') return;
    setAppleErr('');
    setAppleBusy(true);
    try {
      const Apple = await import('expo-apple-authentication');
      const cred = await Apple.signInAsync({
        requestedScopes: [Apple.AppleAuthenticationScope.FULL_NAME],
      });
      if (!cred.identityToken) throw new Error('no_identity_token');
      // The token's sub is the account; cred.fullName/user are never trusted
      // for identity — the name only pre-fills the profile field as a courtesy
      // (Apple hands it over exactly once).
      const result = await appleAuth(cred.identityToken);
      if (cred.fullName?.givenName && !name.trim()) {
        setName([cred.fullName.givenName, cred.fullName.familyName].filter(Boolean).join(' '));
      }
      if (result.existing) nav('home');
      else nav('profile');
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e.code === 'ERR_REQUEST_CANCELED') { /* user closed the sheet — not an error */ }
      else setAppleErr('Sign-in hit a snag — try again in a moment.');
    } finally {
      setAppleBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appleBusy, name]);

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

  /* ── verification code (real, purpose-aware) ──────────────────────────── */

  const verifyCode = useCallback(async (code: string, focusNext: (i: number) => void) => {
    const email = (otpPurpose === 'reset' ? resetEmail : contact).trim().toLowerCase();
    setVerifying(true);
    try {
      const result = await verifyEmailCode(email, code, otpPurpose);
      setVerifying(false);
      if (otpPurpose === 'reset') {
        // The verified code proves email possession; its session signs the
        // password/set call and is then discarded — login stays explicit.
        resetToken.current = result.token;
        nav('reset');
        return;
      }
      // Signup: the session was adopted. `existing` means this email already
      // had an account (raced in since the duplicate check) — that's a login.
      nav(result.existing ? 'home' : 'profile');
    } catch (err) {
      setVerifying(false);
      const code2 = (err as Error).message;
      setOtpErr(true);
      setOtpErrMsg(
        code2 === 'expired_code' ? 'That code expired — resend a fresh one below.'
        : code2 === 'too_many_attempts' ? 'Too many tries — resend a fresh code below.'
        : code2 === 'bad_code' ? '' // the screen's default copy covers it
        : OFFLINE_ERR,
      );
      if (otpTimer.current) clearTimeout(otpTimer.current);
      otpTimer.current = setTimeout(() => { setOtp(EMPTY_OTP); focusNext(0); }, 700);
    }
  }, [contact, nav, otpPurpose, resetEmail]);

  const setOtpDigit = useCallback((index: number, value: string, focusNext: (i: number) => void) => {
    if (verifying) return;
    const digit = value.replace(/\D/g, '').slice(-1);
    setOtp(prev => {
      const next = prev.slice();
      next[index] = digit;
      const code = next.join('');
      if (code.length === 6) void verifyCode(code, focusNext);
      return next;
    });
    setOtpErr(false);
    setOtpErrMsg('');
    if (digit && index < 5) focusNext(index + 1);
  }, [verifying, verifyCode]);

  /* ── username availability (real) ─────────────────────────────────────── */

  const checkUname = useCallback((value: string) => {
    if (unameTimer.current) clearTimeout(unameTimer.current);
    if (!value) { setUnameStatus('idle'); return; }
    if (value.length < 3) { setUnameStatus('short'); return; }
    setUnameStatus('checking');
    unameTimer.current = setTimeout(() => {
      checkUsername(value).then(
        status => setUnameStatus(status === 'invalid' ? 'short' : status),
        // Offline: let the claim proceed — the server's unique index still
        // guards at save; a raced 409 leaves the handle unset, never shared.
        () => setUnameStatus('free'),
      );
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
    // The verify screen serves both signup (contact) and reset (resetEmail).
    const c = (otpPurpose === 'reset' ? resetEmail : contact).trim();
    if (!c) return isEmail ? 'your email' : 'your number';
    if (c.includes('@')) {
      const [user, domain] = c.split('@');
      return (user[0] || '') + '•••@' + domain;
    }
    return '••• ' + c.replace(/\D/g, '').slice(-3);
  }, [contact, isEmail, otpPurpose, resetEmail]);

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

  const submitContact = useCallback(async () => {
    const c = contact.trim().toLowerCase();
    if (contactBusy) return;
    if (isEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c)) {
      setContactErr('That email looks off — one more try?');
      return;
    }
    if (!isEmail && c.replace(/\D/g, '').length < 8) {
      setContactErr('That number looks short — include your country code.');
      return;
    }
    if (!isEmail) {
      // The phone path is hidden in real builds (P3) — reachable only under
      // demo hints, where it stays a tap-through.
      nav('verify');
      return;
    }
    setContactBusy(true);
    try {
      const { exists } = await startEmailCode(c, 'signup');
      setContactBusy(false);
      if (exists) { setExistsOpen(true); return; }
      setOtpPurpose('signup');
      setOtp(EMPTY_OTP);
      nav('verify');
    } catch (err) {
      setContactBusy(false);
      const code = (err as Error).message;
      setContactErr(
        code === 'rate_limited' ? 'Too many codes for that email — give it an hour.'
        : code === 'email_unavailable' ? 'Email codes aren’t live on this build yet — use Continue with Apple for now.'
        : OFFLINE_ERR,
      );
    }
  }, [contact, contactBusy, isEmail, nav]);

  /** Mock social door — only reachable under demo hints (P3 removed the
   *  affordance from real builds; SIWA on iOS is the real social door). */
  const socialJoin = useCallback(() => {
    setContact('sara@icloud.com');
    nav('profile');
  }, [nav]);

  const submitLogin = useCallback(async () => {
    const email = loginEmail.trim().toLowerCase();
    if (loginBusy || !email || !loginPw) { setLoginErr(true); return; }
    setLoginBusy(true);
    try {
      await loginWithPassword(email, loginPw);
      setLoginBusy(false);
      nav('home');
    } catch {
      setLoginBusy(false);
      setLoginErr(true);
    }
  }, [loginBusy, loginEmail, loginPw, nav]);

  /* ── recovery (real): email a code → verify → set the new password ────── */

  const sendReset = useCallback(async () => {
    const email = (resetEmail || loginEmail).trim().toLowerCase();
    if (forgotBusy) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setForgotErr('That email looks off — one more try?');
      return;
    }
    setForgotBusy(true);
    try {
      const { exists, sent } = await startEmailCode(email, 'reset');
      setForgotBusy(false);
      if (!exists || !sent) {
        setForgotErr('No Qleck account under that email — double-check it, or sign up fresh.');
        return;
      }
      setResetEmailRaw(email);
      setOtpPurpose('reset');
      setOtp(EMPTY_OTP);
      nav('sent');
    } catch (err) {
      setForgotBusy(false);
      const code = (err as Error).message;
      setForgotErr(
        code === 'rate_limited' ? 'Too many codes for that email — give it an hour.'
        : code === 'email_unavailable' ? 'Email codes aren’t live on this build yet — hang tight.'
        : OFFLINE_ERR,
      );
    }
  }, [forgotBusy, loginEmail, nav, resetEmail]);

  const saveReset = useCallback(async () => {
    if (resetBusy) return;
    if (resetPw1.length < 8) {
      setResetErr('Needs 8+ characters — stretch it out.');
      return;
    }
    if (resetPw1 !== resetPw2) {
      setResetErr('Those two don’t match. One more go.');
      return;
    }
    if (!resetToken.current) {
      setResetErr('That reset session expired — start again from “Forgot password”.');
      return;
    }
    setResetBusy(true);
    try {
      await setPassword(resetPw1, resetToken.current);
      setResetBusy(false);
      resetToken.current = null;
      setLoginEmail(resetEmail);
      setScreen('login');
      setLoginPw('');
      setLoginErr(false);
      setToast('Password updated — log in with the new one.');
    } catch {
      setResetBusy(false);
      setResetErr(OFFLINE_ERR);
    }
  }, [resetBusy, resetEmail, resetPw1, resetPw2]);

  /** Restart the countdown AND actually send a fresh code (the canvas'
   *  startResend only ran the timer). */
  const resendCode = useCallback(() => {
    if (resendIn > 0) return;
    startResend();
    const purpose = otpPurpose === 'reset' || screen === 'sent' ? 'reset' : 'signup';
    const email = (purpose === 'reset' ? resetEmail : contact).trim().toLowerCase();
    if (email) void startEmailCode(email, purpose).catch(() => {});
  }, [contact, otpPurpose, resendIn, resetEmail, screen, startResend]);

  const copyLink = useCallback(() => {
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1800);
  }, []);

  return {
    appleSignIn, appleBusy, appleErr,
    // screen + navigation
    screen, nav,
    // welcome carousel
    slide, setSlide,
    welcomeNext: () => (slide < 2 ? setSlide(slide + 1) : nav('auth')),
    // signup
    method, isEmail, pickMethod, socialJoin,
    contact, setContact: (v: string) => { setContact(v); setContactErr(''); },
    contactErr, submitContact, contactMasked, contactBusy,
    existsOpen, setExistsOpen,
    existsLogin: () => { setExistsOpen(false); setLoginEmail(contact.trim().toLowerCase()); nav('login'); },
    existsReset: () => { setExistsOpen(false); setResetEmailRaw(contact.trim().toLowerCase()); nav('forgot'); },
    // verify
    otp, otpErr, otpErrMsg, verifying, otpPurpose, setOtpDigit, resendIn, startResend, resendCode,
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
    loginErr, loginBusy, submitLogin,
    // recovery
    resetChannel, setResetChannel,
    resetEmail, setResetEmail: (v: string) => { setResetEmailRaw(v); setForgotErr(''); },
    forgotErr, forgotBusy, sendReset,
    resetPw1, setResetPw1: (v: string) => { setResetPw1(v); setResetErr(''); },
    resetPw2, setResetPw2: (v: string) => { setResetPw2(v); setResetErr(''); },
    resetErr, resetBusy, strength, saveReset,
    // toast
    toast,
  };
}

export type OnboardingFlow = ReturnType<typeof useOnboardingFlow>;
