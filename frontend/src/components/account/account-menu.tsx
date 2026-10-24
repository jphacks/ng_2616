'use client';

import type { UiLang } from '@mn/contracts';
import { Cloud, HardDrive, LogOut, Settings, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DEV_BYPASS, type SessionUser } from '@/core/auth/browser';
import { signOut, signOutClearsDevice, unsyncedCount } from '@/core/auth/session';
import { isCloudUnavailable } from '@/core/persistence/repo';
import { useLocale, useT } from '@/i18n';
import { ConfirmDialog } from '@/ui/dialog';
import { Menu, MenuItem, MenuLabel, MenuLinkItem, MenuPopup, MenuRadioItem, MenuSeparator } from '@/ui/menu';

/**
 * Profile button with the account menu: storage status, settings, language, sign out.
 * `canLeave` lets an editor with unsaved changes veto navigation.
 */
export function AccountMenu({ user, unsaved = false, canLeave }: { user: SessionUser; unsaved?: boolean; canLeave?: () => boolean }) {
  const t = useT();
  const router = useRouter();
  const { locale, setLocale } = useLocale();
  const [confirming, setConfirming] = useState(false);
  // outbox entries and resources this device has not sent yet (signing out tries to send them first)
  const [unsent, setUnsent] = useState(0);
  const local = DEV_BYPASS || isCloudUnavailable();

  return (
    <>
      <Menu.Root>
        <Menu.Trigger
          aria-label={t('account.menu')}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          <span className="flex size-9 items-center justify-center rounded-full bg-black/[0.06] text-ink-soft ring-1 ring-ink/5 transition-transform duration-150 active:scale-95">
            <UserRound size={19} aria-hidden />
          </span>
        </Menu.Trigger>
        <MenuPopup className="w-72">
          <div className="flex items-center gap-3 px-3 pt-2 pb-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-black/[0.06] text-ink-soft">
              <UserRound size={20} aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-medium">{user.name ?? user.email}</span>
              <span className="flex items-center gap-1.5 text-[12px] text-muted">
                {local ? <HardDrive size={13} aria-hidden /> : <Cloud size={13} aria-hidden />}
                {t(local ? 'account.storage.local' : 'account.storage.cloud')}
              </span>
            </span>
          </div>
          <MenuSeparator />
          <MenuLinkItem
            icon={<Settings size={18} />}
            render={<Link href="/settings" />}
            onClick={(e) => {
              if (canLeave && !canLeave()) e.preventDefault();
            }}
          >
            {t('account.settings')}
          </MenuLinkItem>
          <MenuSeparator />
          <Menu.RadioGroup value={locale} onValueChange={(v) => setLocale(v as UiLang)}>
            <MenuLabel>{t('account.language')}</MenuLabel>
            <MenuRadioItem value="en" closeOnClick>{t('lang.en')}</MenuRadioItem>
            <MenuRadioItem value="ja" closeOnClick>{t('lang.ja')}</MenuRadioItem>
          </Menu.RadioGroup>
          <MenuSeparator />
          <MenuItem danger icon={<LogOut size={18} />} onClick={() => {
            setConfirming(true);
            void unsyncedCount(user.id).then(setUnsent, () => setUnsent(0));
          }}>
            {t('account.signOut')}
          </MenuItem>
        </MenuPopup>
      </Menu.Root>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('account.signOutTitle')}
        description={
          <>
            {(unsaved || unsent > 0) && <span className="mb-2 block font-medium text-wrong-strong">{t('sync.signOutUnsent')}</span>}
            {t(signOutClearsDevice() ? 'account.signOutClears' : 'account.signOutKeeps')}
          </>
        }
        confirmLabel={t('account.signOut')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={async () => {
          await signOut(user.id);
          router.replace('/login');
        }}
      />
    </>
  );
}
