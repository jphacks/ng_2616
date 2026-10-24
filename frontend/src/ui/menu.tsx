'use client';

import { Menu as BaseMenu } from '@base-ui/react/menu';
import clsx from 'clsx';
import { Check } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

export const Menu = BaseMenu;

/** Portal + positioner + popup with the app's surface style; scales in from its anchor. */
export function MenuPopup({
  children,
  anchor,
  side = 'bottom',
  align = 'end',
  sideOffset = 8,
  className,
}: {
  children: ReactNode;
  anchor?: ComponentProps<typeof BaseMenu.Positioner>['anchor'];
  side?: ComponentProps<typeof BaseMenu.Positioner>['side'];
  align?: ComponentProps<typeof BaseMenu.Positioner>['align'];
  sideOffset?: number;
  className?: string;
}) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner anchor={anchor} side={side} align={align} sideOffset={sideOffset} collisionPadding={12} className="z-popover outline-none">
        <BaseMenu.Popup
          className={clsx(
            'min-w-56 origin-[var(--transform-origin)] rounded-2xl bg-sheet p-1.5 text-ink shadow-float outline-none ring-1 ring-ink/5',
            'transition-[scale,opacity] duration-fast ease-out motion-reduce:transition-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0',
            className,
          )}
        >
          {children}
        </BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  );
}

const itemClass = (danger?: boolean) =>
  clsx(
    'flex min-h-11 cursor-default select-none items-center gap-3 rounded-xl px-3 text-base outline-none',
    danger ? 'text-danger data-highlighted:bg-danger-soft' : 'text-ink data-highlighted:bg-hover',
    'data-disabled:text-faint',
  );

export function MenuItem({ icon, danger, children, ...rest }: ComponentProps<typeof BaseMenu.Item> & { icon?: ReactNode; danger?: boolean }) {
  return (
    <BaseMenu.Item className={itemClass(danger)} {...rest}>
      {icon && <span className={clsx('shrink-0', danger ? 'text-danger' : 'text-ink-soft')}>{icon}</span>}
      {children}
    </BaseMenu.Item>
  );
}

export function MenuLinkItem({ icon, children, ...rest }: ComponentProps<typeof BaseMenu.LinkItem> & { icon?: ReactNode }) {
  return (
    <BaseMenu.LinkItem className={itemClass()} {...rest}>
      {icon && <span className="shrink-0 text-ink-soft">{icon}</span>}
      {children}
    </BaseMenu.LinkItem>
  );
}

export function MenuRadioItem({ children, ...rest }: ComponentProps<typeof BaseMenu.RadioItem>) {
  return (
    <BaseMenu.RadioItem className={itemClass()} {...rest}>
      <span className="flex size-[18px] shrink-0 items-center justify-center text-accent">
        <BaseMenu.RadioItemIndicator>
          <Check size={17} />
        </BaseMenu.RadioItemIndicator>
      </span>
      {children}
    </BaseMenu.RadioItem>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <BaseMenu.GroupLabel className="px-3 pt-2 pb-1 text-xs font-medium text-muted">{children}</BaseMenu.GroupLabel>;
}

export function MenuSeparator() {
  return <BaseMenu.Separator className="mx-2 my-1.5 h-px bg-border" />;
}
