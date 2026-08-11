import { AuthButtons } from '@/components/auth/AuthButtons';
import { BalancePill } from '@/components/wallet/BalancePill';
import { Logo } from '@/components/layout/Logo';

export function TopBar() {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-app items-center gap-1.5 px-3 sm:gap-2 sm:px-4">
        <Logo />

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <BalancePill />
          <AuthButtons />
        </div>
      </div>
    </header>
  );
}
