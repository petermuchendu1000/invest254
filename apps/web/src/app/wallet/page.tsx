'use client';

import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { WalletWidget } from '@/components/wallet/WalletWidget';
import { HistoryTabs } from '@/components/wallet/HistoryTabs';
import { useSession } from '@/lib/auth/session';
import { useAuthUi } from '@/lib/auth/ui';
import { useDepositUi } from '@/lib/wallet/depositUi';
import { useHydrated } from '@/lib/useHydrated';

export default function WalletPage() {
  const hydrated = useHydrated();
  const token = useSession((s) => s.token);
  const openAuth = useAuthUi((s) => s.openAuth);
  const openDeposit = useDepositUi((s) => s.openDeposit);
  const openWithdraw = useDepositUi((s) => s.openWithdraw);

  if (!hydrated) return <Skeleton className="h-48 w-full" />;

  if (!token) {
    return (
      <EmptyState
        title="Sign in to view your wallet"
        description="Log in to deposit, withdraw, and see your transaction history."
        action={<Button onClick={() => openAuth('login')}>Log in</Button>}
      />
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold tracking-tight">Wallet</h1>

      <WalletWidget />

      <div className="grid grid-cols-2 gap-3">
        <Button size="lg" onClick={() => openDeposit()}>Deposit</Button>
        <Button size="lg" variant="secondary" onClick={openWithdraw}>Withdraw</Button>
      </div>

      <h2 className="mt-2 text-base font-semibold">History</h2>
      <HistoryTabs />
    </section>
  );
}
