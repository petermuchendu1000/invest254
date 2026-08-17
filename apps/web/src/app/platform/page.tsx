'use client';

import { useMemo, useState } from 'react';
import { PageHeader, StatCard, Section, TableWrap, Th, Td, Toolbar, FilterSelect, Empty } from '@/components/admin/ui';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  usePlatformOverview,
  usePlatformSites,
  usePlatformMarketerRollup,
  useOnboardClient,
  useDomainStatus,
} from '@/lib/platform/hooks';
import type { SiteWithConfig, SiteKpis, MarketerRollupGroup, OnboardResult } from '@/lib/platform/endpoints';
import { ClientDetail } from '@/components/platform/ClientDetail';
import { downloadCsv } from '@/components/admin/BulkSelect';

const money = (cents: number, cur = 'KES') => `${cur} ${(cents / 100).toLocaleString()}`;

/** Instant client onboarding: brand + economy + (optional) domain provisioning, in one action. */
function OnboardClient() {
  const onboard = useOnboardClient();
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('KES');
  const [primaryDomain, setDomain] = useState('');
  const [supportEmail, setSupportEmail] = useState('');
  const [colorPrimary, setColor] = useState('#3861FB');
  const [provision, setProvision] = useState(true);
  const [result, setResult] = useState<OnboardResult | null>(null);
  const provisionedDomain = result?.domain?.domain ?? null;
  useDomainStatus(provisionedDomain);

  return (
    <form
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        const dom = primaryDomain.trim();
        const email = supportEmail.trim();
        onboard.mutate(
          {
            slug: slug.trim(), name: name.trim(), currency: currency.trim() || 'KES',
            ...(dom ? { primaryDomain: dom } : {}),
            ...(email ? { supportEmail: email } : {}),
            colors: { primary: colorPrimary },
            provisionDomain: provision && Boolean(dom),
          },
          { onSuccess: (r) => setResult(r) },
        );
      }}
    >
      <Input label="Brand name" name="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Tamu Traders" required />
      <Input label="Slug" name="slug" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="tamutraders" required />
      <Input label="Primary domain" name="primaryDomain" value={primaryDomain} onChange={(e) => setDomain(e.target.value)} placeholder="tamutraders.com" optional />
      <Input label="Currency" name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} />
      <Input label="Support email" name="supportEmail" type="email" value={supportEmail} onChange={(e) => setSupportEmail(e.target.value)} placeholder="support@tamutraders.com" optional />
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-fg">Seed colour</span>
        <input type="color" value={colorPrimary} onChange={(e) => setColor(e.target.value)} className="h-12 w-full rounded-brand border border-border bg-surface-2" />
      </label>
      <label className="flex items-center gap-2 text-sm text-fg sm:col-span-2 md:col-span-3">
        <input type="checkbox" checked={provision} onChange={(e) => setProvision(e.target.checked)} />
        Provision the domain automatically (Cloudflare zone + DNS + SSL, Namecheap nameservers)
      </label>
      <div className="sm:col-span-2 md:col-span-3">
        <Button type="submit" disabled={onboard.isPending || !slug.trim() || !name.trim()}>
          {onboard.isPending ? 'Creating…' : 'Create client'}
        </Button>
        {onboard.isError ? <span className="ml-3 text-sm text-down">{(onboard.error as Error).message}</span> : null}
        {result ? <span className="ml-3 text-sm text-up">{result.brand.name} is live (site {result.brand.siteId.slice(0, 8)}).</span> : null}
      </div>
    </form>
  );
}

/** Cross-brand marketer rollup: who brought which clients on which site, and their total. */
function MarketerRollup() {
  const rollup = usePlatformMarketerRollup();
  const groups: MarketerRollupGroup[] = rollup.data?.marketers ?? [];
  return (
    <TableWrap>
      <thead>
        <tr><Th>Marketer</Th><Th>Brand</Th><Th>Clients</Th><Th>GGR</Th><Th>Commission</Th></tr>
      </thead>
      <tbody>
        {groups.map((g) => {
          const key = g.marketerGlobalId ?? g.sites[0]?.affiliateUserId ?? 'unknown';
          const heading = g.label ?? `Unlinked · ${g.sites[0]?.affiliateUserId ?? ''}`;
          return [
            ...g.sites.map((s, i) => (
              <tr key={`${key}-${s.siteId}-${s.affiliateUserId}`} className="border-t border-border">
                <Td>{i === 0 ? <span className="font-semibold text-fg">{heading}</span> : <span className="text-muted">↳</span>}</Td>
                <Td>{s.siteName} <span className="text-muted">· {s.siteSlug}</span></Td>
                <Td>{s.clients.toLocaleString()}</Td>
                <Td>{money(s.ggrCents)}</Td>
                <Td>{money(s.commissionCents)}</Td>
              </tr>
            )),
            g.sites.length > 1 ? (
              <tr key={`${key}-total`} className="border-t border-border bg-surface-2">
                <Td className="font-semibold text-fg">Total</Td>
                <Td className="text-muted">{g.sites.length} brands</Td>
                <Td className="font-semibold text-fg">{g.totals.clients.toLocaleString()}</Td>
                <Td className="font-semibold text-fg">{money(g.totals.ggrCents)}</Td>
                <Td className="font-semibold text-fg">{money(g.totals.commissionCents)}</Td>
              </tr>
            ) : null,
          ];
        })}
        {groups.length === 0 ? <tr><Td className="text-muted">{rollup.isLoading ? 'Loading…' : 'No marketers yet.'}</Td></tr> : null}
      </tbody>
    </TableWrap>
  );
}

export default function PlatformPage() {
  const overview = usePlatformOverview();
  const sites = usePlatformSites();
  const kpis: SiteKpis[] = overview.data?.sites ?? [];
  const siteList: SiteWithConfig[] = sites.data?.sites ?? [];
  const kpiById = useMemo(() => new Map(kpis.map((k) => [k.siteId, k])), [kpis]);

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'ggr', dir: 'desc' });

  const totals = useMemo(() => kpis.reduce((a, k) => ({
    users: a.users + k.users, deposits: a.deposits + k.depositsCents, ggr: a.ggr + k.ggrCents, open: a.open + k.openPositions,
  }), { users: 0, deposits: 0, ggr: 0, open: 0 }), [kpis]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return siteList.filter((x) =>
      (status === 'all' || x.status === status) &&
      (!s || x.name.toLowerCase().includes(s) || x.slug.includes(s) || (x.primaryDomain ?? '').includes(s)));
  }, [siteList, q, status]);

  // Per-brand launch readiness (drives the Health column + "Needs setup" KPI): a brand is live-ready
  // once its domain is set and both M-Pesa rails (pay-in creds + B2C pay-out) are configured.
  const readiness = (s: SiteWithConfig) => {
    const domainOk = !!s.primaryDomain;
    const depOk = !!(s.hasMpesaConsumerKey && s.hasMpesaConsumerSecret && s.hasMpesaPasskey);
    const b2cOk = !!s.hasMpesaB2cCredential;
    return { domainOk, depOk, b2cOk, score: [domainOk, depOk, b2cOk].filter(Boolean).length };
  };
  const enriched = useMemo(() => rows.map((s) => ({ s, k: kpiById.get(s.siteId), r: readiness(s) })), [rows, kpiById]);
  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    const val = (e: (typeof enriched)[number]): string | number => {
      switch (sort.key) {
        case 'name': return e.s.name.toLowerCase();
        case 'status': return e.s.status;
        case 'players': return e.k?.users ?? 0;
        case 'deposits': return e.k?.depositsCents ?? 0;
        case 'ggr': return e.k?.ggrCents ?? 0;
        case 'bets': return e.k?.bets ?? 0;
        case 'ready': return e.r.score;
        default: return 0;
      }
    };
    return [...enriched].sort((a, b) => { const av = val(a), bv = val(b); return av < bv ? -dir : av > bv ? dir : 0; });
  }, [enriched, sort]);
  const needsSetup = enriched.filter((e) => e.r.score < 3).length;
  const exportClients = () =>
    downloadCsv(`clients-${new Date().toISOString().slice(0, 10)}.csv`, enriched.map(({ s, k, r }) => ({
      brand: s.name, slug: s.slug, status: s.status, domain: s.primaryDomain ?? '',
      players: k?.users ?? 0, depositsKES: ((k?.depositsCents ?? 0) / 100).toFixed(2),
      ggrKES: ((k?.ggrCents ?? 0) / 100).toFixed(2), bets: k?.bets ?? 0,
      domainSet: r.domainOk, mpesaPayIn: r.depOk, mpesaPayout: r.b2cOk,
    })));

  const selected = siteList.find((x) => x.siteId === selectedId) ?? rows[0] ?? siteList[0] ?? null;

  return (
    <div className="mx-auto w-full max-w-app space-y-6 p-4">
      <PageHeader title="Platform console" subtitle="Total control of every client — onboard, brand, tune the economy, and monitor each brand." />

      {/* Platform-wide KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Brands" value={siteList.length} hint={`${kpis.filter((k) => k.status === 'active').length} active`} />
        <StatCard label="Players" value={totals.users.toLocaleString()} />
        <StatCard label="Deposits" money={totals.deposits} tone="up" />
        <StatCard label="GGR" money={totals.ggr} tone={totals.ggr >= 0 ? 'up' : 'down'} />
        <StatCard label="Open positions" value={totals.open.toLocaleString()} />
        <StatCard label="Needs setup" value={needsSetup} tone={needsSetup > 0 ? 'warn' : 'up'} hint="domain / M-Pesa incomplete" />
      </div>

      {/* Clients table */}
      <Section title="Clients">
        <Toolbar>
          <Input name="search" placeholder="Search brand, slug or domain…" value={q} onChange={(e) => setQ(e.target.value)} className="w-64 max-w-full" />
          <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: 'all', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'paused', label: 'Paused' }, { value: 'archived', label: 'Archived' }]} />
          <span className="text-xs text-muted">{rows.length} of {siteList.length}</span>
          <Button variant="outline" size="sm" onClick={exportClients} className="ml-auto">Export CSV</Button>
        </Toolbar>
        <TableWrap>
          <thead>
            <tr>
              <Sortable label="Brand" k="name" sort={sort} setSort={setSort} />
              <Sortable label="Status" k="status" sort={sort} setSort={setSort} />
              <Th>Health</Th>
              <Th>Domain</Th>
              <Sortable label="Players" k="players" sort={sort} setSort={setSort} align="right" />
              <Sortable label="Deposits" k="deposits" sort={sort} setSort={setSort} align="right" />
              <Sortable label="GGR" k="ggr" sort={sort} setSort={setSort} align="right" />
              <Sortable label="Bets" k="bets" sort={sort} setSort={setSort} align="right" />
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ s, k, r }) => {
              const active = selected?.siteId === s.siteId;
              return (
                <tr key={s.siteId} onClick={() => setSelectedId(s.siteId)}
                  className={`cursor-pointer border-t border-border transition hover:bg-surface-2 ${active ? 'bg-surface-2' : ''}`}>
                  <Td><span className="font-semibold text-fg">{s.name}</span> <span className="text-muted">· {s.slug}</span></Td>
                  <Td><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s.status === 'active' ? 'bg-up/20 text-up' : s.status === 'paused' ? 'bg-warn/20 text-warn' : 'bg-surface-2 text-muted'}`}>{s.status}</span></Td>
                  <Td><HealthPill r={r} /></Td>
                  <Td className="text-muted">{s.primaryDomain ?? '—'}</Td>
                  <Td className="text-right tabular-nums">{(k?.users ?? 0).toLocaleString()}</Td>
                  <Td className="text-right tabular-nums">{money(k?.depositsCents ?? 0)}</Td>
                  <Td className="text-right tabular-nums">{money(k?.ggrCents ?? 0)}</Td>
                  <Td className="text-right tabular-nums">{(k?.bets ?? 0).toLocaleString()}</Td>
                </tr>
              );
            })}
            {sorted.length === 0 ? <tr><Td className="text-muted">{sites.isLoading ? 'Loading…' : 'No brands match.'}</Td></tr> : null}
          </tbody>
        </TableWrap>
      </Section>

      {/* Selected client — full management surface */}
      <Section title="Client detail">
        {selected ? <ClientDetail key={selected.siteId} site={selected} /> : <Empty title="No client selected" description="Pick a brand from the table above." />}
      </Section>

      <Section title="Onboard a client"><OnboardClient /></Section>
      <Section title="Marketer rollup (cross-brand)"><MarketerRollup /></Section>
    </div>
  );
}

/** Clickable, sort-aware column header (click to toggle desc→asc; shows the active arrow). */
function Sortable({ label, k, sort, setSort, align }: {
  label: string; k: string;
  sort: { key: string; dir: 'asc' | 'desc' };
  setSort: (s: { key: string; dir: 'asc' | 'desc' }) => void;
  align?: 'right';
}) {
  const activeCol = sort.key === k;
  const arrow = activeCol ? (sort.dir === 'asc' ? '↑' : '↓') : '';
  return (
    <Th {...(align === 'right' ? { className: 'text-right' } : {})}>
      <button
        type="button"
        onClick={() => setSort({ key: k, dir: activeCol && sort.dir === 'desc' ? 'asc' : 'desc' })}
        className={`inline-flex items-center gap-1 hover:text-fg ${activeCol ? 'text-fg' : ''}`}
      >
        {label}<span className="text-[10px]">{arrow}</span>
      </button>
    </Th>
  );
}

/** Compact launch-readiness signals: domain set, M-Pesa pay-in creds, M-Pesa B2C pay-out. */
function HealthPill({ r }: { r: { domainOk: boolean; depOk: boolean; b2cOk: boolean; score: number } }) {
  const Item = ({ ok, label }: { ok: boolean; label: string }) => (
    <span
      className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium ${ok ? 'bg-up/15 text-up' : 'bg-surface-2 text-muted'}`}
      title={`${label}: ${ok ? 'configured' : 'not set'}`}
    >
      <span>{ok ? '✓' : '○'}</span>{label}
    </span>
  );
  return (
    <span className="flex flex-wrap gap-1">
      <Item ok={r.domainOk} label="Domain" />
      <Item ok={r.depOk} label="Pay-in" />
      <Item ok={r.b2cOk} label="Pay-out" />
    </span>
  );
}
