-- 0030_realistic_chat_seed.sql — Replace the AI-looking simulated chat backlog with realistic,
-- Kenyan-style Aviator group-chat lines (Sheng/Swahili-English, M-Pesa cash-out talk, minimal
-- emoji), and index the feed so the "@user just won X" ticker query stays fast.
--
-- Scope: only touches SIMULATED chat (chat_messages.user_id IS NULL). Real player messages
-- (user_id NOT NULL) are never deleted. Mirrors packages/shared/src/activity.ts CHAT_LINES so
-- the DB seed and the runtime simulator draw from the same pool.
--
-- Idempotent: guarded on a sentinel line so re-applying does not stack duplicate backlogs.

-- ── Feed/chat read-path indexes (feed + chat both do `order by created_at desc limit N`) ──
create index if not exists idx_activity_feed_created_at on public.activity_feed (created_at desc);
create index if not exists idx_chat_messages_created_at on public.chat_messages (created_at desc);

do $seed$
declare
  names  text[] := array[
    'brian','kevin','john','peter','james','david','samuel','dennis','victor','collins',
    'wanjiku','achieng','amina','njeri','faith','mercy','grace','cynthia','esther','joy',
    'otieno','kamau','mwangi','kiprop','wafula','omondi','chebet','barasa','mutua','njoroge',
    'shiro','zawadi','baraka','imani','salim','halima','rashid','abdi','yusuf','fatuma'];
  styles text[] := array['{n}_254','{n}.ke','{n}{d}','{n}_{d}','mr{n}','ms{n}','{n}official','the{n}'];
  lines  text[] := array[
    'nimeweka 200 nimetoa 1,500 leo',
    'cashout mapema bro usingoje x10',
    'mimi huwa nacashout kwa 2x tu',
    'hii curve iko poa leo',
    'weka pesa polepole usiharakishe',
    'nani ako up leo?',
    'niko na streak ya wins tatu mfululizo',
    'usiogope kuweka, weka tu utaona',
    'form ni kucashout mapema',
    'nimeanza na 100 saa hii niko 800',
    'weka 500 utoe 3k',
    'polepole ndio mwendo',
    'tumia akili usiweke yote kwa moja',
    'M-Pesa deposit ni instant kabisa',
    'green run imeanza, tuweke',
    'nacashout na 3x sina stress',
    'deposit small, toa mapema, rudia',
    'wewe umeweka ngapi leo?',
    'chukua profit mapema bro',
    'hii ndio side hustle yangu fr',
    'nimetoa 5k nimeweka kwa M-Pesa',
    'cashout ni discipline bana',
    'usikimbie x10, chukua 2x uende',
    'leo niko poa, wins tatu',
    'weka ka 200 hivi ujaribu',
    'pesa iko, deposit iko instant',
    'mimi nacashout kabla curve ianguke',
    'naona green leo, tuweke haraka',
    'sina haraka, polepole na 2x',
    'form ni kuweka na kutoa mapema',
    'nani anajua timing ya cashout?',
    'leo nimeanza vizuri, deposit imeingia',
    'toa mapema ushinde mara nyingi',
    'mimi huweka kidogo natoa mob',
    'usikae pembeni, weka deposit ushiriki',
    'niko na target ya 2k leo',
    'cashout ni kila kitu, ni timing bro',
    'weka deposit uone vibe yenyewe',
    'nimeweka rent nikatoa double 💰',
    'cashout kwa 1.5x pia ni win',
    'hapa ni akili sio bahati tu',
    'leo ni leo, deposit tu',
    'green tena, weka haraka 🔥',
    'aki hii game inanipa doo',
    'nimecashout, next round tuko',
    'weka pesa mnono uone difference',
    'timing ya cashout ndio kila kitu',
    'small stake, toa mapema, rudia tena',
    'leo doo iko, tumefika',
    'usiogope, anza na 200 tu'];
  n int := 800;                 -- refreshed, larger backlog
  i int; nm text; st text; d int; uname text; msg text; ts timestamptz;
begin
  if not exists (select 1 from public.chat_messages where user_id is null and message = lines[1]) then
    delete from public.chat_messages where user_id is null;
    for i in 1..n loop
      nm := names[ (('x'||substr(md5(i::text||'cname'),1,7))::bit(28)::int % array_length(names,1)) + 1 ];
      st := styles[ (('x'||substr(md5(i::text||'cstyle'),1,7))::bit(28)::int % array_length(styles,1)) + 1 ];
      d  := (('x'||substr(md5(i::text||'cd'),1,7))::bit(28)::int % 999) + 1;
      uname := replace(replace(st,'{n}',nm),'{d}', d::text);
      msg := lines[ (('x'||substr(md5(i::text||'line'),1,7))::bit(28)::int % array_length(lines,1)) + 1 ];
      ts := now() - ((('x'||substr(md5(i::text||'cts'),1,7))::bit(28)::int % (3*24*3600)) * interval '1 second');
      insert into public.chat_messages(user_id, username, message, is_hidden, created_at)
        values (null, uname, msg, false, ts);
    end loop;
  end if;
end
$seed$;
