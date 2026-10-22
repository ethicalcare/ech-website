'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Session } from './live-model';
import { createSessionClient } from './session';
type CheckApi = { render: (element: HTMLElement, options: { sitekey: string; action: string; callback: (token: string) => void; 'expired-callback': () => void; 'error-callback': () => void }) => string; remove: (id: string) => void };
function SignInCheck({ siteKey, onToken }: { siteKey: string; onToken: (token: string) => void }) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let stopped = false; let widget: string | undefined;
    const api = () => (window as unknown as { turnstile?: CheckApi }).turnstile;
    const mount = () => { if (!stopped && element.current && api()) widget = api()!.render(element.current, { sitekey: siteKey, action: 'admin-login', callback: onToken, 'expired-callback': () => onToken(''), 'error-callback': () => onToken('') }); };
    let script = document.querySelector<HTMLScriptElement>('script[data-admin-login-check]');
    if (api()) mount(); else {
      if (!script) { script = document.createElement('script'); script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; script.async = true; script.dataset.adminLoginCheck = 'true'; document.head.appendChild(script); }
      script.addEventListener('load', mount); script.addEventListener('error', () => onToken(''), { once: true });
    }
    return () => { stopped = true; script?.removeEventListener('load', mount); if (widget !== undefined) api()?.remove(widget); onToken(''); };
  }, [siteKey, onToken]);
  return <div ref={element} aria-label="Sign-in security check" />;
}
export function SignIn({ session, client, onVerified }: { session: Extract<Session, {authenticated:false}>; client: ReturnType<typeof createSessionClient>; onVerified: () => Promise<void> }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [passwordMode, setPasswordMode] = useState(true); const [token, setToken] = useState(''); const [challenge, setChallenge] = useState(''); const [sent, setSent] = useState(false); const [pending, setPending] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState(''); const errorRef = useRef<HTMLParagraphElement>(null); const [attempt, setAttempt] = useState(0); const busy = useRef(false);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy.current) return; busy.current = true; setPending(true); setMessage(''); setError('');
    try { if (passwordMode) { await client.password(email.trim(),password,challenge); setPassword(''); await onVerified(); } else if (sent) { await client.verify(email.trim(), token.trim()); setToken(''); await onVerified(); } else { await client.login(email.trim(), challenge); setSent(true); setMessage('If this address is authorized, a sign-in code will be sent.'); } }
    catch { setError('Sign-in could not be confirmed. Check your entries and try again.'); }
    finally { busy.current = false; setPending(false); setChallenge(''); setAttempt(value => value + 1); }
  }
  return <section className="panel intake-form"><p className="eyebrow">Ethical Care at Home</p><h1>Staff sign-in</h1><p>Sign in with your individually authorized ECH account.</p>{session.login.siteKey === null && !sent && <p role="alert" className="field-error">Sign-in setup is unavailable. Account configuration must be completed before signing in.</p>}{error && <p ref={errorRef} tabIndex={-1} role="alert" className="field-error">{error}</p>}{message && <p role="status">{message}</p>}<form onSubmit={submit}><fieldset disabled={pending}><label><span>Individual email</span><input type="email" autoComplete="email" required maxLength={254} value={email} disabled={sent} onChange={event => setEmail(event.target.value)} /></label>{passwordMode && <label><span>Password</span><input aria-label="Password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></label>}{!passwordMode && sent ? <label><span>Eight-digit sign-in code</span><input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{8}" required value={token} onChange={event => setToken(event.target.value)} maxLength={8} /></label> : session.login.siteKey && <SignInCheck key={attempt} siteKey={session.login.siteKey} onToken={setChallenge} />}<button type="submit" disabled={!sent && !challenge}>{pending ? 'Checking…' : passwordMode ? 'Sign in' : sent ? 'Verify sign-in' : 'Request sign-in code'}</button>{!passwordMode && sent && <button type="button" onClick={() => { setSent(false); setToken(''); setMessage(''); setError(''); }}>Use another email or request a new code</button>}<button type="button" onClick={() => {setPasswordMode(value=>!value);setSent(false);setPassword('');setToken('');setMessage('');setError('');setAttempt(value=>value+1);}}>{passwordMode ? 'Use an email code' : 'Use password sign-in'}</button></fieldset></form></section>;
}
