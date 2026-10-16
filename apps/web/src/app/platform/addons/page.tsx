'use client';

import Link from 'next/link';

import * as React from 'react';
import { formatKes } from '@invest254/shared/money';
import { useCan } from '@/lib/auth/can';
import { Empty, PageHeader, SearchInput, Section, StatCard, TableWrap, Th, Td } from '@/components/admin/ui';
import { PageTabs, useTabParam } from '@/components/admin/Tabs';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { Switch } from '@/components/platform/PaymentsIndex';
import { useToast } from '@/lib/toast/ToastProvider';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/cn';
import { parseKes } from '@/lib/billing/labels';
import {
  useAddonBrands, useAddonCatalog, useAddonPlatforms, useAddonRequests, useDecideAddonRequest,
  useGrantPlatformAddon, useRevokePlatformAddon, useUpdateAddon,
} from '@/lib/addons/hooks';
import type { AddonCategory, AddonPlatformRow, AddonRequestRow, BillingType, CatalogItem } from '@/lib/addons/endpoints';
import {
  AddonPreview, CATEGORY, NoteField, RequestHistory, RequestSummary, billingSentence, errMsg, priceText,
} from '@/components/addons/Marketplace';

/**
 * ADDON-1 (docs/48) — Add-ons.
 * System owner: Requests inbox (approve / decline with a note and the exact billing consequence), the Catalog
 * (pricing model, price, setup fee, description, offered, adoption) and every Brand's add-ons.
 * Platform admin: pick one of its brands → the marketplace (request, withdraw, switch) + its platform's requests.
 */
export default function AddonsPage() {
  return useCan('console.system') ? <OwnerAddons /> : <PlatformAddons />;
}

const TABS = [
  { id: 'requests', label: 'Requests', hint: 'What brands asked for' },
  { id: 'catalog', label: 'Catalog', hint: 'Prices, pricing model, what is offered' },
  { id: 'platforms', label: 'Platforms', hint: 'What each platform owns — gateways are bought here' },
  { id: 'brands', label: 'Brands', hint: 'What each brand owns and uses' },
] as const;
type Tab = (typeof TABS)[number]['id'];

function OwnerAddons() {
  const [tab, setTab] = useTabParam<Tab>(TABS.map((t) => t.id), 'requests');
  const cat = useAddonCatalog();
  const open = useAddonRequests('requested');
  const items = cat.data?.items ?? [];
  const paid = items.filter((i) => !i.is_default && i.billing_type !== 'free');
  const owned = paid.reduce((s, i) => s + (i.brands ?? 0), 0);
  const monthly = paid.filter((i) => i.billing_type === 'monthly').reduce((s, i) => s + i.price_cents * (i.brands ?? 0), 0);
  const pending = open.data?.requests.length ?? 0;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Add-ons" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Open requests" value={pending} tone={pending ? 'warn' : 'default'} hint={pending ? 'Waiting for your decision' : 'Nothing waiting'} />
        <StatCard label="Paid add-ons owned" value={owned} hint="Across all brands" />
        <StatCard label="Monthly add-on revenue" money={monthly} hint="Monthly add-ons × brands that own them" />
        <StatCard label="Offered" value={`${items.filter((i) => i.active).length} of ${items.length}`} hint="Add-ons brands can request" />
      </div>
      <PageTabs tabs={TABS.map((t) => (t.id === 'requests' && pending ? { ...t, label: `Requests (${pending})` } : t))} value={tab} onChange={setTab} label="Add-on sections" />
      {tab === 'requests' ? <RequestsInbox />
        : tab === 'catalog' ? <Catalog items={items} loading={cat.isLoading} />
        : tab === 'platforms' ? <PlatformsMatrix items={items} />
        : <BrandsMatrix items={items} />}
    </div>
  );
}

const REQ_FILTERS = [
  { id: 'requested', label: 'Open' }, { id: 'approved', label: 'Approved' }, { id: 'rejected', label: 'Declined' },
  { id: 'cancelled', label: 'Withdrawn' }, { id: '', label: 'All' },
] as const;

function RequestsInbox() {
  const [status, setStatus] = React.useState<string>('requested');
  const q = useAddonRequests(status || undefined);
  const [review, setReview] = React.useState<{ req: AddonRequestRow; decision: 'approve' | 'reject' } | null>(null);
  const rows = q.data?.requests ?? [];
  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="Request status" className="flex w-fit flex-wrap gap-1 rounded-xl bg-surface-2 p-1">
        {REQ_FILTERS.map((f) => (
          <button key={f.id || 'all'} type="button" role="tab" aria-selected={status === f.id} onClick={() => setStatus(f.id)}
            className={cn('h-8 rounded-lg px-3 text-sm font-medium transition', status === f.id ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg')}>{f.label}</button>
        ))}
      </div>
      {q.isLoading ? <Skeleton className="h-40 w-full" /> : !rows.length ? (
        <Empty title={status === 'requested' ? 'No open requests' : 'Nothing here'} {...(status === 'requested' ? { description: 'When a brand asks for an add-on it shows here with its reason and the price it was quoted.' } : {})} />
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Requests">
          {rows.map((r) => {
            const p = priceText(r.billing_type, r.price_cents, r.setup_fee_cents);
            return (
              <li key={r.id} className="grid gap-3 rounded-2xl border border-border bg-surface p-4 md:grid-cols-[160px_1fr_auto] md:items-center">
                <AddonPreview category={r.category} keyName={r.key} name={r.display_name} />
                <div className="min-w-0 text-sm">
                  <div className="font-semibold">{r.display_name} <span className="font-normal text-muted">for</span> {r.name}{r.platform_name ? <span className="font-normal text-muted"> · {r.platform_name}</span> : null}</div>
                  <div className="text-muted">{p.main}{p.extra ? ` ${p.extra}` : ''} · asked {formatDate(r.created_at)}{r.requested_by_name ? ` by @${r.requested_by_name}` : ''}</div>
                  {r.note ? <div className="mt-1">“{r.note}”</div> : null}
                  {r.decision_note ? <div className="mt-1 text-muted">Your reply: “{r.decision_note}”</div> : null}
                </div>
                {r.status === 'requested' ? (
                  <div className="flex gap-2 md:flex-col">
                    <Button size="sm" onClick={() => setReview({ req: r, decision: 'approve' })}>Approve…</Button>
                    <Button size="sm" variant="outline" onClick={() => setReview({ req: r, decision: 'reject' })}>Decline…</Button>
                  </div>
                ) : <span className="text-sm text-muted">{r.status === 'approved' ? 'Approved' : r.status === 'rejected' ? 'Declined' : 'Withdrawn'}{r.decided_at ? ` ${formatDate(r.decided_at)}` : ''}</span>}
              </li>
            );
          })}
        </ul>
      )}
      <DecideModal review={review} onClose={() => setReview(null)} />
    </div>
  );
}

function DecideModal({ review, onClose }: { review: { req: AddonRequestRow; decision: 'approve' | 'reject' } | null; onClose: () => void }) {
  const [note, setNote] = React.useState('');
  const decide = useDecideAddonRequest();
  const toast = useToast();
  React.useEffect(() => { setNote(''); }, [review]);
  if (!review) return null;
  const { req, decision } = review;
  const approve = decision === 'approve';
  return (
    <Modal open onClose={onClose} size="sm" title={approve ? `Approve ${req.display_name} for ${req.name}?` : `Decline ${req.display_name}?`}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button variant={approve ? 'primary' : 'down'} disabled={decide.isPending || (!approve && !note.trim())}
          onClick={() => decide.mutate({ id: req.id, decision, ...(note.trim() ? { note: note.trim() } : {}) }, {
            onSuccess: () => { toast.push({ tone: 'success', title: approve ? `${req.display_name} assigned to ${req.name}` : 'Request declined', description: 'The brand was notified.' }); onClose(); },
            onError: (e) => toast.push({ tone: 'error', title: 'Not saved', description: errMsg(e) }),
          })}>{approve ? 'Approve and assign' : 'Decline'}</Button></>}>
      <div className="flex flex-col gap-3 text-sm">
        <RequestSummary req={req} />
        <NoteField value={note} onChange={setNote} label={approve ? 'Note to the brand' : 'Reason (shown to the brand)'} placeholder={approve ? 'e.g. Enjoy. It is live now' : 'e.g. Not available on your plan'} />
      </div>
    </Modal>
  );
}

const BILLING: { id: BillingType; label: string; hint: string }[] = [
  { id: 'free', label: 'Free', hint: 'No charge' },
  { id: 'one_off', label: 'One-off', hint: 'Charged once' },
  { id: 'monthly', label: 'Monthly', hint: 'On every renewal' },
];

function Catalog({ items, loading }: { items: CatalogItem[]; loading: boolean }) {
  const [edit, setEdit] = React.useState<CatalogItem | null>(null);
  if (loading) return <Skeleton className="h-72 w-full" />;
  return (
    <div className="flex flex-col gap-6">
      {(Object.keys(CATEGORY) as AddonCategory[]).map((c) => {
        const list = items.filter((i) => i.category === c);
        if (!list.length) return null;
        return (
          <Section key={c} title={CATEGORY[c].title}>
            <TableWrap>
              <thead className="border-b border-border"><tr><Th>Add-on</Th><Th>Pricing</Th><Th numeric>Price</Th><Th numeric>Setup</Th><Th numeric>Brands</Th><Th>Status</Th><Th className="w-px" /></tr></thead>
              <tbody className="divide-y divide-border">
                {list.map((i) => (
                  <tr key={i.key} className={cn(!i.active && 'opacity-60')}>
                    <Td><div className="font-medium">{i.display_name}{i.is_default ? <span className="ml-2 rounded-full bg-up/15 px-2 py-0.5 text-[10px] font-semibold text-up">DEFAULT</span> : null}</div>
                      <div className="max-w-md truncate text-xs text-muted" title={i.description}>{i.description || 'No description'}</div></Td>
                    <Td><span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', i.billing_type === 'monthly' ? 'bg-info/15 text-info' : i.billing_type === 'one_off' ? 'bg-accent/15 text-accent' : 'bg-surface-2 text-muted')}>
                      {BILLING.find((b) => b.id === i.billing_type)?.label}</span></Td>
                    <Td numeric>{i.price_cents ? formatKes(i.price_cents) : '-'}</Td>
                    <Td numeric>{i.setup_fee_cents ? formatKes(i.setup_fee_cents) : '-'}</Td>
                    <Td numeric>{i.brands ?? 0}{c !== 'payment_gateway' && i.in_use ? <span className="block text-xs text-muted">{i.in_use} using</span> : null}</Td>
                    <Td>{i.active ? <span className="text-sm text-up">Offered</span> : <span className="text-sm text-muted">Hidden</span>}{i.pending ? <span className="block text-xs text-warn">{i.pending} request{i.pending === 1 ? '' : 's'}</span> : null}</Td>
                    <Td><Button size="sm" variant="outline" onClick={() => setEdit(i)} aria-label={`Edit ${i.display_name}`}>Edit</Button></Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </Section>
        );
      })}
      <EditAddon item={edit} onClose={() => setEdit(null)} />
    </div>
  );
}

function EditAddon({ item, onClose }: { item: CatalogItem | null; onClose: () => void }) {
  const [name, setName] = React.useState(''); const [desc, setDesc] = React.useState('');
  const [type, setType] = React.useState<BillingType>('free'); const [price, setPrice] = React.useState(''); const [setup, setSetup] = React.useState('');
  const [active, setActive] = React.useState(true);
  const save = useUpdateAddon(); const toast = useToast();
  React.useEffect(() => {
    if (!item) return;
    setName(item.display_name); setDesc(item.description); setType(item.billing_type); setActive(item.active);
    setPrice(item.price_cents ? String(item.price_cents / 100) : ''); setSetup(item.setup_fee_cents ? String(item.setup_fee_cents / 100) : '');
  }, [item]);
  if (!item) return null;
  const priceC = type === 'free' ? 0 : parseKes(price); const setupC = type === 'free' ? 0 : setup.trim() ? parseKes(setup) : 0;
  const errors: Record<string, string> = {};
  if (type !== 'free' && (priceC == null || priceC <= 0)) errors.price = 'Enter a price above zero.';
  if (setupC == null || setupC < 0) errors.setup = 'Enter an amount, or leave empty.';
  if (!name.trim()) errors.name = 'Required.';
  const locked = item.is_default;
  const preview = priceText(type, priceC ?? 0, setupC ?? 0);
  return (
    <Modal open onClose={onClose} title={`Edit ${item.display_name}`} size="md"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={!!Object.keys(errors).length || save.isPending} onClick={() => save.mutate({ category: item.category, key: item.key, patch: {
          displayName: name.trim(), description: desc.trim(), billingType: type, priceCents: priceC ?? 0, setupFeeCents: setupC ?? 0, active,
        } }, { onSuccess: () => { toast.push({ tone: 'success', title: `${name.trim()} saved`, description: 'New prices apply to new requests; open requests keep the price they were quoted.' }); onClose(); },
          onError: (e) => toast.push({ tone: 'error', title: 'Not saved', description: errMsg(e) }) })}>Save</Button></>}>
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} error={errors.name} />
          <AddonPreview category={item.category} keyName={item.key} name={item.display_name} />
        </div>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Description <span className="text-xs font-normal text-muted">(shown to brands)</span></span>
          <textarea rows={2} maxLength={400} value={desc} onChange={(e) => setDesc(e.target.value)}
            className="rounded-brand border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent" />
        </label>
        <fieldset disabled={locked} className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-medium">Pricing {locked ? <span className="text-xs font-normal text-muted">, the default is always free</span> : null}</legend>
          <div role="radiogroup" aria-label="Pricing model" className="grid grid-cols-3 gap-2">
            {BILLING.map((b) => (
              <button key={b.id} type="button" role="radio" aria-checked={type === b.id} onClick={() => setType(b.id)}
                className={cn('rounded-xl border p-3 text-left text-sm transition disabled:opacity-50', type === b.id ? 'border-accent bg-accent/10' : 'border-border hover:bg-surface-2')}>
                <span className="font-medium">{b.label}</span><span className="block text-xs text-muted">{b.hint}</span>
              </button>
            ))}
          </div>
          {type !== 'free' ? (
            <div className="grid grid-cols-2 gap-3">
              <Input label={type === 'monthly' ? 'Price per month (KES)' : 'Price (KES)'} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} error={errors.price} />
              <Input label="Setup fee (KES)" optional inputMode="decimal" value={setup} onChange={(e) => setSetup(e.target.value)} error={errors.setup} hint="Charged once, when assigned" />
            </div>
          ) : null}
        </fieldset>
        <p className="rounded-xl bg-surface-2 p-3 text-sm">Brands see: <b>{preview.main}</b>{preview.extra ? ` ${preview.extra}` : ''}</p>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span><span className="font-medium">Offer to brands</span><span className="block text-xs text-muted">Hidden add-ons can't be requested; brands that own one keep it.</span></span>
          <Switch checked={active} onChange={setActive} label="Offer to brands" disabled={locked} />
        </label>
      </div>
    </Modal>
  );
}

/**
 * What each PLATFORM owns, and the only place a platform's add-ons are granted or removed.
 *
 * Add-ons are bought by the platform and every one of its brands inherits them, so this is the tier
 * where a gateway purchase actually lives — the Brands tab below shows what that inheritance produced.
 * Until this screen existed, fn_platform_addon_grant / fn_platform_addon_revoke (migration 0172) had no
 * caller at all and a platform could only be granted a gateway by hand in SQL. That is how platform
 * MUGO came to own no gateway while running on its own payment accounts, and why its brand `dakafx`
 * showed "Deposits are temporarily unavailable" to its first player for 5h45m.
 *
 * The "Deposits" column is the warning that was missing: a platform on its own accounts whose owned
 * gateways are all switched off globally has NOTHING to offer its brands' players.
 */
function PlatformsMatrix({ items }: { items: CatalogItem[] }) {
  const q = useAddonPlatforms();
  const [search, setSearch] = React.useState('');
  const [manage, setManage] = React.useState<AddonPlatformRow | null>(null);
  const name = (ref: string) => items.find((i) => `${i.category}:${i.key}` === ref)?.display_name ?? ref.split(':')[1];
  if (q.isLoading) return <Skeleton className="h-60 w-full" />;
  const rows = (q.data?.platforms ?? []).filter((p) => !search || `${p.name} ${p.slug}`.toLowerCase().includes(search.toLowerCase()));
  // Keep the open modal in step with a refetch after a grant / revoke.
  const current = manage ? rows.find((r) => r.platform_id === manage.platform_id) ?? manage : null;
  return (
    <div className="flex flex-col gap-3">
      <SearchInput value={search} onChange={setSearch} placeholder="Find a platform" />
      {!rows.length ? <Empty title="No platforms" description="Platforms own the add-ons their brands inherit." /> : (
        <TableWrap>
          <thead className="border-b border-border"><tr><Th>Platform</Th><Th numeric>Brands</Th><Th>Gateways owned</Th><Th>Deposits</Th><Th className="w-px" /></tr></thead>
          <tbody className="divide-y divide-border">
            {rows.map((p) => {
              const gateways = p.owned.filter((o) => o.startsWith('payment_gateway:'));
              // The dakafx state: live on its own accounts with no globally-enabled gateway to serve.
              const stranded = p.scope_active && p.live_rails.length === 0;
              return (
                <tr key={p.platform_id} className={cn(p.status !== 'active' && 'opacity-60')}>
                  <Td>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-muted">{p.slug}{p.plan_key ? ` · ${p.plan_key}` : ''}{p.billing_exempt ? ' · not billed' : ''}</div>
                  </Td>
                  <Td numeric>{p.sites}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {gateways.length ? gateways.map((o) => (
                        <span key={o} className="rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent"
                          title={p.grandfathered.includes(o) ? 'Recognised as already owned — never billed' : 'Purchased'}>
                          {name(o)}{p.grandfathered.includes(o) ? '*' : ''}
                        </span>
                      )) : <span className="text-muted">None</span>}
                    </div>
                  </Td>
                  <Td>
                    {stranded ? (
                      <span className="font-medium text-down" title="This platform is live on its own payment accounts, but none of the gateways it owns is switched on globally — its brands have no way to deposit.">
                        No live rail
                      </span>
                    ) : p.scope_active ? (
                      <span className="text-sm">Own accounts<span className="block text-xs text-muted">{p.live_rails.map((r) => name(`payment_gateway:${r}`)).join(', ')}</span></span>
                    ) : <span className="text-sm text-muted">System accounts</span>}
                  </Td>
                  <Td><Button size="sm" variant="outline" onClick={() => setManage(p)} aria-label={`Manage ${p.name} add-ons`}>Manage</Button></Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      )}
      <p className="text-xs text-muted">* Recognised as already owned, so it was never billed.</p>
      <ManagePlatform platform={current} items={items} onClose={() => setManage(null)} />
    </div>
  );
}

/**
 * Grant / remove one platform's add-ons. Both writes are system-owner-only in the route AND in the RPC.
 * Two things are stated before confirming, because both are easy to get wrong and expensive:
 *   - a grant either raises a charge or is recognised as already owned (grandfathered);
 *   - a removal can strand every brand on the platform with no way to deposit.
 */
function ManagePlatform({ platform, items, onClose }: { platform: AddonPlatformRow | null; items: CatalogItem[]; onClose: () => void }) {
  const grant = useGrantPlatformAddon();
  const revoke = useRevokePlatformAddon();
  const toast = useToast();
  const [confirm, setConfirm] = React.useState<{ item: CatalogItem; mode: 'grant' | 'revoke' } | null>(null);
  const [asOwned, setAsOwned] = React.useState(false);
  React.useEffect(() => { setAsOwned(false); }, [confirm]);
  if (!platform) return null;
  const owned = new Set(platform.owned);
  const busy = grant.isPending || revoke.isPending;

  const act = () => {
    if (!confirm) return;
    const { item, mode } = confirm;
    const base = { platform: platform.platform_id, category: item.category, key: item.key };
    const done = (title: string, description: string) => {
      toast.push({ tone: 'success', title, description });
      setConfirm(null);
    };
    const fail = (e: unknown) => toast.push({ tone: 'error', title: 'Not saved', description: errMsg(e) });
    if (mode === 'grant') {
      grant.mutate({ ...base, grandfathered: asOwned }, {
        onSuccess: () => done(`${item.display_name} added to ${platform.name}`,
          `All ${platform.sites} brand${platform.sites === 1 ? '' : 's'} on this platform can use it now.`
          + (asOwned ? ' Nothing was billed.' : '')),
        onError: fail,
      });
    } else {
      revoke.mutate(base, {
        onSuccess: () => done(`${item.display_name} removed from ${platform.name}`,
          'Brands that were granted it individually keep it.'),
        onError: fail,
      });
    }
  };

  return (
    <>
      <Modal open onClose={onClose} size="lg" title={`${platform.name} — add-ons`}
        description={`Owned by the platform and inherited by all ${platform.sites} of its brand${platform.sites === 1 ? '' : 's'}.`}
        footer={<Button variant="outline" onClick={onClose}>Done</Button>}>
        <div className="flex flex-col gap-5">
          {platform.scope_active && platform.live_rails.length === 0 ? (
            <p className="rounded-xl border border-down/40 bg-down/10 p-3 text-sm">
              <b>Its brands cannot deposit.</b> {platform.name} is live on its own payment accounts, but none of the
              gateways it owns is switched on globally, so the deposit sheet has nothing to offer. Add a gateway it can
              actually use, or switch this platform back to the System accounts.
            </p>
          ) : null}
          {(Object.keys(CATEGORY) as AddonCategory[]).map((c) => {
            const list = items.filter((i) => i.category === c);
            if (!list.length) return null;
            return (
              <Section key={c} title={CATEGORY[c].title}>
                <ul className="flex flex-col gap-2">
                  {list.map((i) => {
                    const ref = `${i.category}:${i.key}`;
                    const has = owned.has(ref);
                    const p = priceText(i.billing_type, i.price_cents, i.setup_fee_cents);
                    return (
                      <li key={i.key} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-2 p-3 text-sm">
                        <div className="min-w-0">
                          <div className="font-medium">
                            {i.display_name}
                            {i.is_default ? <span className="ml-2 rounded-full bg-up/15 px-2 py-0.5 text-[10px] font-semibold text-up">FREE FOR ALL</span> : null}
                            {has && platform.grandfathered.includes(ref) ? <span className="ml-2 text-xs font-normal text-muted">already owned</span> : null}
                          </div>
                          <div className="text-xs text-muted">{p.main}{p.extra ? ` ${p.extra}` : ''}{!i.active ? ' · hidden from brands' : ''}</div>
                        </div>
                        {i.is_default ? (
                          <span className="shrink-0 text-xs text-muted" title="Every platform and brand gets this one free, whether or not a row exists.">Always included</span>
                        ) : has ? (
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirm({ item: i, mode: 'revoke' })}>Remove</Button>
                        ) : (
                          <Button size="sm" disabled={busy || !i.active} onClick={() => setConfirm({ item: i, mode: 'grant' })}
                            title={i.active ? undefined : 'Hidden add-ons cannot be granted. Offer it in the Catalog first.'}>Add</Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </Section>
            );
          })}
        </div>
      </Modal>

      {confirm ? (
        <Modal open onClose={() => setConfirm(null)} size="sm"
          title={confirm.mode === 'grant' ? `Add ${confirm.item.display_name} to ${platform.name}?` : `Remove ${confirm.item.display_name} from ${platform.name}?`}
          footer={<><Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant={confirm.mode === 'grant' ? 'primary' : 'down'} disabled={busy} onClick={act}>
              {confirm.mode === 'grant' ? 'Add to platform' : 'Remove'}
            </Button></>}>
          <div className="flex flex-col gap-3 text-sm">
            <p className="text-muted">
              Every one of {platform.name}&apos;s {platform.sites} brand{platform.sites === 1 ? '' : 's'}{' '}
              {confirm.mode === 'grant' ? 'will be able to use this.' : 'loses this, unless it was granted the add-on on its own.'}
            </p>
            {confirm.mode === 'grant' ? (
              <>
                <p className="rounded-xl bg-surface-2 p-3">
                  {asOwned ? 'Recognised as already owned. Nothing is billed.'
                    : billingSentence(confirm.item.billing_type, confirm.item.price_cents, confirm.item.setup_fee_cents)}
                  {platform.billing_exempt ? ' This platform is marked not billed, so no charge is raised either way.' : ''}
                </p>
                <label className="flex items-center justify-between gap-3">
                  <span>
                    <span className="font-medium">Already owned</span>
                    <span className="block text-xs text-muted">They already had it under an earlier arrangement — never raise a charge.</span>
                  </span>
                  <Switch checked={asOwned} onChange={setAsOwned} label="Recognise as already owned" />
                </label>
              </>
            ) : (
              <RemoveWarning platform={platform} item={confirm.item} />
            )}
          </div>
        </Modal>
      ) : null}
    </>
  );
}

/** Removing a gateway can leave a platform's brands unable to deposit. Say so before it happens. */
function RemoveWarning({ platform, item }: { platform: AddonPlatformRow; item: CatalogItem }) {
  if (item.category !== 'payment_gateway') return <p className="text-muted">Nothing is refunded. You can add it back at any time.</p>;
  const remaining = platform.live_rails.filter((r) => r !== item.key);
  const wasLive = platform.live_rails.includes(item.key);
  if (platform.scope_active && wasLive && remaining.length === 0) {
    return (
      <p className="rounded-xl border border-down/40 bg-down/10 p-3">
        <b>This stops deposits.</b> {platform.name} is live on its own payment accounts and {item.display_name} is the
        only gateway it owns that is switched on, so removing it leaves all {platform.sites} brand
        {platform.sites === 1 ? '' : 's'} with no way to deposit — their deposit sheet will read
        &ldquo;Deposits are temporarily unavailable&rdquo;.
      </p>
    );
  }
  if (platform.scope_active && wasLive) {
    return <p className="rounded-xl bg-surface-2 p-3">Deposits keep working on {remaining.join(', ')}. Nothing is refunded.</p>;
  }
  return <p className="text-muted">It is not serving deposits right now, so nothing changes for players. Nothing is refunded.</p>;
}

function BrandsMatrix({ items }: { items: CatalogItem[] }) {
  const q = useAddonBrands();
  const [search, setSearch] = React.useState('');
  const name = (ref: string) => items.find((i) => `${i.category}:${i.key}` === ref)?.display_name ?? ref.split(':')[1];
  const paidRef = new Set(items.filter((i) => !i.is_default).map((i) => `${i.category}:${i.key}`));
  if (q.isLoading) return <Skeleton className="h-60 w-full" />;
  const rows = (q.data?.brands ?? []).filter((b) => !search || `${b.name} ${b.platform_name ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="flex flex-col gap-3">
      <SearchInput value={search} onChange={setSearch} placeholder="Find a brand or platform" />
      {!rows.length ? <Empty title="No brands" /> : (
        <TableWrap>
          <thead className="border-b border-border"><tr><Th>Brand</Th><Th>Chart in use</Th><Th>Trade screen</Th><Th>Paid add-ons owned</Th><Th className="w-px" /></tr></thead>
          <tbody className="divide-y divide-border">
            {rows.map((b) => {
              const paidOwned = b.owned.filter((o) => paidRef.has(o));
              return (
                <tr key={b.site_id}>
                  <Td><div className="font-medium">{b.name}</div><div className="text-xs text-muted">{b.platform_name ?? 'No platform'}{b.pending ? <span className="text-warn"> · {b.pending} request{b.pending === 1 ? '' : 's'}</span> : null}</div></Td>
                  <Td>{name(`chart:${b.chart_style}`)}</Td>
                  <Td>{name(`trade_ui:${b.trade_ui}`)}</Td>
                  <Td><div className="flex flex-wrap gap-1">{paidOwned.length ? paidOwned.map((o) => <span key={o} className="rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent">{name(o)}</span>) : <span className="text-muted">None</span>}</div></Td>
                  <Td><Link href={`/platform/clients/${b.site_id}?tab=addons`} className="inline-flex h-9 items-center rounded-brand border border-border px-3 text-sm font-medium hover:bg-surface-2">Manage</Link></Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      )}
    </div>
  );
}

/**
 * Platform admin: every brand's add-ons at a glance + the platform's requests. Managing ONE brand's add-ons
 * has one home — the brand page's Add-ons tab (UI-F); this page links there.
 */
function PlatformAddons() {
  const brands = useAddonBrands();
  const cat = useAddonCatalog();
  const list = brands.data?.brands ?? [];
  const items = cat.data?.items ?? [];
  const name = (ref: string) => items.find((i) => `${i.category}:${i.key}` === ref)?.display_name ?? ref.split(':')[1];
  const paid = new Set(items.filter((i) => !i.is_default).map((i) => `${i.category}:${i.key}`));
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Add-ons" />
      {brands.isLoading ? <Skeleton className="h-40 w-full" /> : !list.length ? <Empty title="No brands yet" description="Onboard a brand first." /> : (
        <ul className="grid gap-3 md:grid-cols-2" aria-label="Your brands' add-ons">
          {list.map((b) => {
            const owned = b.owned.filter((o) => paid.has(o));
            return (
              <li key={b.site_id} className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{b.name}</span>
                  {b.pending ? <span className="rounded-full bg-warn/15 px-2 py-0.5 text-xs font-medium text-warn">{b.pending} request{b.pending === 1 ? '' : 's'} waiting</span> : null}
                </div>
                <div className="text-muted">Chart: <span className="text-fg">{name(`chart:${b.chart_style}`)}</span> · Trade screen: <span className="text-fg">{name(`trade_ui:${b.trade_ui}`)}</span></div>
                <div className="flex flex-wrap gap-1">{owned.length ? owned.map((o) => <span key={o} className="rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent">{name(o)}</span>) : <span className="text-xs text-muted">No paid add-ons</span>}</div>
                <Link href={`/platform/clients/${b.site_id}?tab=addons`} className="mt-1 w-fit text-sm font-medium text-accent hover:underline">Manage add-ons →</Link>
              </li>
            );
          })}
        </ul>
      )}
      <OwnedByYourPlatform items={items} />
      <Section title="Requests from your brands">
        <RequestHistory emptyText="Requests you or your brand admins send, and the System owner's answers, show here." />
      </Section>
    </div>
  );
}

/**
 * Read-only: what the admin's OWN platform owns, and whether its brands can actually deposit.
 *
 * A platform admin cannot grant itself an add-on — gateways are sold by the System owner — but it could
 * previously not even SEE that its platform owned none, which is the gap that let MUGO go live on its
 * own payment accounts with nothing its brands could use. The warning here is the one that would have
 * caught `dakafx` before its players did.
 */
function OwnedByYourPlatform({ items }: { items: CatalogItem[] }) {
  const q = useAddonPlatforms();
  const mine = q.data?.platforms?.[0];
  if (q.isLoading) return <Skeleton className="h-28 w-full" />;
  if (!mine) return null;
  const name = (ref: string) => items.find((i) => `${i.category}:${i.key}` === ref)?.display_name ?? ref.split(':')[1];
  const gateways = mine.owned.filter((o) => o.startsWith('payment_gateway:'));
  const stranded = mine.scope_active && mine.live_rails.length === 0;
  return (
    <Section title="What your platform owns">
      <div className="flex flex-col gap-3 text-sm">
        {stranded ? (
          <p className="rounded-xl border border-down/40 bg-down/10 p-3">
            <b>Your brands cannot deposit.</b> {mine.name} is live on its own payment accounts, but none of the gateways
            it owns is switched on, so the deposit sheet has nothing to offer. Ask the System owner for a gateway you can
            use, or switch back to the System accounts in Payment accounts.
          </p>
        ) : null}
        <div>
          <span className="text-muted">Payment gateways: </span>
          {gateways.length ? (
            <span className="inline-flex flex-wrap gap-1">
              {gateways.map((o) => <span key={o} className="rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent">{name(o)}</span>)}
            </span>
          ) : <span className="text-muted">none beyond the free M-Pesa every platform gets</span>}
        </div>
        <div className="text-muted">
          {mine.scope_active
            ? <>Deposits run on your own payment accounts{mine.live_rails.length ? <> via {mine.live_rails.map((r) => name(`payment_gateway:${r}`)).join(', ')}</> : null}.</>
            : <>Deposits run on the System owner&apos;s accounts.</>}
          {' '}Inherited by all {mine.sites} of your brand{mine.sites === 1 ? '' : 's'}.
        </div>
        <p className="text-xs text-muted">Add-ons are bought per platform. Request one below and the System owner assigns it.</p>
      </div>
    </Section>
  );
}
