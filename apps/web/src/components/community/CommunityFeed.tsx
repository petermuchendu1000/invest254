'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';
import { useSession } from '@/lib/auth/session';
import { useEffectiveRole } from '@/lib/auth/can';
import { useBrand } from '@/lib/brand/BrandProvider';
import { useCommunity, useCommunityVote, useCommunityAdmin } from '@/lib/affiliate/hooks';
import type { CommunityPostDto } from '@/lib/api/types';

/**
 * The brand's community channel (docs/56).
 *
 * A CHANNEL, not a group: operators post, everyone else reads and votes. There is no player
 * composer here and there is none on the server either — a brand's own channel carrying an
 * unmoderated player conversation is a support and compliance surface nobody asked for, and players
 * already have a voice in the trade screen's live chat.
 */
export function CommunityFeed() {
  const token = useSession((s) => s.token);
  const role = useEffectiveRole();
  const brand = useBrand();
  const { data, isPending } = useCommunity(!!token);
  const isAdmin = role === 'admin' || role === 'platform_admin' || role === 'platform_superadmin';

  if (!token) {
    return <Empty>Log in to see what {brand.name} is posting.</Empty>;
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-fg">{brand.name} community</h1>
        <p className="mt-0.5 text-xs text-muted">Announcements, questions and live sessions from the team.</p>
      </header>

      {isAdmin ? <Composer /> : null}

      {isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-surface" />)}
        </div>
      ) : !data?.items.length ? (
        <Empty>Nothing posted yet.</Empty>
      ) : (
        <ul className="space-y-3">
          {data.items.map((p) => <Post key={p.id} post={p} isAdmin={isAdmin} />)}
        </ul>
      )}
    </div>
  );
}

function Post({ post, isAdmin }: { post: CommunityPostDto; isAdmin: boolean }) {
  const vote = useCommunityVote();
  const admin = useCommunityAdmin();

  return (
    <li className={cn('rounded-xl border bg-surface p-4', post.pinned ? 'border-accent/50' : 'border-border')}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] text-muted">
          {post.pinned ? <span className="rounded bg-accent/15 px-1.5 py-0.5 font-semibold text-accent">Pinned</span> : null}
          {post.kind === 'live' ? <span className="rounded bg-down/15 px-1.5 py-0.5 font-semibold text-down">Live</span> : null}
          <span>{post.author}</span>
          <span>·</span>
          <time dateTime={post.createdAt}>{new Date(post.createdAt).toLocaleDateString([], { day: 'numeric', month: 'short' })}</time>
        </div>
        {isAdmin ? (
          <div className="flex shrink-0 gap-1 text-[11px]">
            <AdminAction onClick={() => admin.pin.mutate({ id: post.id, pinned: !post.pinned })}>{post.pinned ? 'Unpin' : 'Pin'}</AdminAction>
            {post.kind === 'poll' ? (
              <AdminAction onClick={() => admin.close.mutate({ id: post.id, closed: !post.closed })}>{post.closed ? 'Reopen' : 'Close'}</AdminAction>
            ) : null}
            <AdminAction tone="down" onClick={() => admin.remove.mutate(post.id)}>Delete</AdminAction>
          </div>
        ) : null}
      </div>

      {post.title ? <h2 className="mb-1 text-sm font-semibold text-fg">{post.title}</h2> : null}
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg/90">{post.body}</p>

      {post.streamUrl ? (
        <a
          href={post.streamUrl}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="mt-3 inline-flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-accent-fg"
        >
          Watch the live
        </a>
      ) : null}

      {post.kind === 'poll' && post.options.length > 0 ? (
        <div className="mt-3 space-y-1.5">
          {post.options.map((o) => {
            const pct = post.totalVotes > 0 ? Math.round((o.votes / post.totalVotes) * 100) : 0;
            const mine = post.myVote === o.id;
            return (
              <button
                key={o.id}
                type="button"
                disabled={post.closed || vote.isPending}
                onClick={() => vote.mutate({ postId: post.id, optionId: o.id })}
                className={cn(
                  'relative w-full overflow-hidden rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed',
                  mine ? 'border-accent text-fg' : 'border-border text-fg/90 hover:border-accent/50',
                )}
              >
                {/* The bar is the result, drawn behind the label rather than beside it, so a long
                    option name never squeezes the number off the row. */}
                <span className="absolute inset-y-0 left-0 bg-accent/15" style={{ width: `${pct}%` }} aria-hidden="true" />
                <span className="relative flex items-center justify-between gap-3">
                  <span className="truncate">{mine ? '✓ ' : ''}{o.label}</span>
                  <span className="shrink-0 text-xs text-muted">{pct}%</span>
                </span>
              </button>
            );
          })}
          <p className="pt-0.5 text-[11px] text-muted">
            {post.totalVotes} {post.totalVotes === 1 ? 'vote' : 'votes'}{post.closed ? ' · closed' : ''}
          </p>
        </div>
      ) : null}
    </li>
  );
}

/** The admin composer: a note, or a question with choices. */
function Composer() {
  const admin = useCommunityAdmin();
  const [kind, setKind] = useState<'post' | 'poll'>('post');
  const [body, setBody] = useState('');
  const [options, setOptions] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const send = () => {
    setErr(null);
    const opts = options.split('\n').map((s) => s.trim()).filter(Boolean);
    if (kind === 'poll' && opts.length < 2) { setErr('A question needs at least two choices.'); return; }
    admin.post.mutate(
      { kind, body: body.trim(), ...(kind === 'poll' ? { options: opts } : {}) },
      { onSuccess: () => { setBody(''); setOptions(''); }, onError: (e) => setErr(e instanceof Error ? e.message : 'Could not post.') },
    );
  };

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-2 flex gap-1">
        {(['post', 'poll'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={cn('rounded-lg px-3 py-1 text-xs font-semibold',
              kind === k ? 'bg-accent text-accent-fg' : 'border border-border text-muted')}
          >
            {k === 'post' ? 'Announcement' : 'Question'}
          </button>
        ))}
      </div>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder={kind === 'poll' ? 'Ask your question — e.g. Do we go live at 10am?' : 'Write to your players…'}
        className="w-full rounded-lg border border-border bg-bg p-3 text-sm text-fg outline-none focus:border-accent"
      />

      {kind === 'poll' ? (
        <textarea
          value={options}
          onChange={(e) => setOptions(e.target.value)}
          rows={3}
          placeholder={'One choice per line\n10am\n2pm\n8pm'}
          className="mt-2 w-full rounded-lg border border-border bg-bg p-3 text-sm text-fg outline-none focus:border-accent"
        />
      ) : null}

      {err ? <p className="mt-2 text-xs text-down">{err}</p> : null}

      <button
        type="button"
        disabled={!body.trim() || admin.post.isPending}
        onClick={send}
        className="mt-2 h-9 w-full rounded-lg bg-accent text-sm font-semibold text-accent-fg disabled:opacity-50"
      >
        {admin.post.isPending ? 'Posting…' : kind === 'poll' ? 'Ask' : 'Post'}
      </button>
    </section>
  );
}

function AdminAction({ children, onClick, tone }: { children: React.ReactNode; onClick: () => void; tone?: 'down' }) {
  return (
    <button type="button" onClick={onClick} className={cn('rounded px-1.5 py-0.5 hover:bg-border/50', tone === 'down' ? 'text-down' : 'text-muted')}>
      {children}
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="mx-auto max-w-2xl px-4 py-10 text-center text-sm text-muted">{children}</p>;
}
