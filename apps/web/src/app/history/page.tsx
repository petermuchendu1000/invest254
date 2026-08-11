import { HistoryTabs } from '@/components/wallet/HistoryTabs';

export default function HistoryPage() {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-fg">History</h1>
      <HistoryTabs />
    </section>
  );
}
