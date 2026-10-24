'use client';

import { Languages, Mail, Sigma } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AUTH_PROVIDERS, DEV_BYPASS, supabaseBrowser } from '@/core/auth/browser';
import { APP_BUILD_VERSION } from '@/core/version';
import { useLocale, useT } from '@/i18n';
import { Button } from '@/ui/button';
import { Spinner } from '@/ui/spinner';

const RESEND_SECONDS = 60;

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/** Magic link + OAuth sign-in (spec §4.1; open sign-up per Stage 1 decision). */
export function LoginForm() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const { locale, setLocale } = useLocale();
  const next = params.get('next') ?? '/notebooks';
  const urlError = params.get('error');
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const callback = () => `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  const sendLink = async () => {
    if (!email.includes('@')) return;
    setState('sending');
    setError(null);
    const { error: err } = await supabaseBrowser().auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: callback() } });
    if (err) {
      setState('error');
      setError(err.message);
      return;
    }
    setState('sent');
    setCooldown(RESEND_SECONDS);
  };

  const oauth = async (provider: 'google' | 'azure' | 'github') => {
    setError(null);
    const { error: err } = await supabaseBrowser().auth.signInWithOAuth({ provider, options: { redirectTo: callback() } });
    if (err) setError(err.message);
  };

  const shownError = error ?? (urlError ? (/expired|invalid|otp/i.test(urlError) ? t('login.expired') : t('login.error', { msg: urlError })) : null);

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-6">
      <div className="w-full max-w-md space-y-8">
        <div className="flex items-center justify-between">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-ink text-white">
            <Sigma size={22} />
          </span>
          <Button variant="ghost" icon={<Languages size={18} />} onClick={() => setLocale(locale === 'en' ? 'ja' : 'en')}>
            {t('top.language')}
          </Button>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">{t('app.name')}</h1>
            <span className="rounded bg-accent/15 px-2 py-0.5 font-mono text-[12px] font-bold text-accent">
              {APP_BUILD_VERSION}
            </span>
          </div>
          <p className="text-[15px] text-muted">{t('app.tagline')}</p>
        </div>
        <div className="space-y-5 rounded-3xl bg-sheet p-7 shadow-card">
          <div>
            <h2 className="text-lg font-semibold">{t('login.title')}</h2>
            <p className="text-[14px] text-muted">{t('login.subtitle')}</p>
          </div>
          {DEV_BYPASS ? (
            <div className="space-y-3">
              <p className="rounded-xl bg-unknown-soft p-3 text-[14px] text-unknown">{t('login.devBypass')}</p>
              <Button variant="primary" className="w-full" onClick={() => router.push(next)}>
                {t('login.continue')}
              </Button>
            </div>
          ) : (
            <>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendLink();
                }}
              >
                <label className="block space-y-1.5">
                  <span className="text-[13px] font-medium text-muted">{t('login.email')}</span>
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    inputMode="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t('login.emailPlaceholder')}
                    className="h-12 w-full rounded-xl bg-paper px-4 text-[16px] outline-none ring-1 ring-border focus:ring-2 focus:ring-accent/50"
                  />
                </label>
                <Button type="submit" variant="primary" size="lg" className="w-full" disabled={state === 'sending' || cooldown > 0} icon={state === 'sending' ? <Spinner /> : <Mail size={18} />}>
                  {state === 'sending' ? t('login.sending') : state === 'sent' ? (cooldown > 0 ? t('login.resendIn', { s: cooldown }) : t('login.resend')) : t('login.sendLink')}
                </Button>
                {state === 'sent' && <p className="rounded-xl bg-ok-soft p-3 text-[14px] text-ok">{t('login.sent')}</p>}
              </form>
              {AUTH_PROVIDERS.length > 0 && (
                <>
                  <div className="flex items-center gap-3 text-[12px] uppercase tracking-wide text-faint">
                    <span className="h-px flex-1 bg-border" />
                    {t('login.or')}
                    <span className="h-px flex-1 bg-border" />
                  </div>
                  <div className="space-y-2">
                    {AUTH_PROVIDERS.map((p) => (
                      <Button key={p} size="lg" className="w-full" icon={p === 'google' ? <GoogleMark /> : undefined} onClick={() => void oauth(p)}>
                        {t(`login.${p}`)}
                      </Button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
          {shownError && <p className="rounded-xl bg-wrong-soft p-3 text-[14px] text-wrong-strong">{shownError}</p>}
        </div>
      </div>
    </div>
  );
}
