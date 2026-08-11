-- 0013 seed simulated engagement backlog (>=500 activity_feed + >=500 chat_messages)
-- Deterministic (md5-derived from a row index) and idempotent (only seeds when the
-- simulated set is empty). Simulated activity rows carry is_simulated=true; simulated
-- chat rows carry user_id=NULL (no backing profile) — both are auditable as non-real.
-- created_at is spread across the recent past so the feed/chat look organically populated.

do $seed$
declare
  names  text[] := array[
    'brian','kevin','john','peter','james','david','samuel','dennis','victor','collins',
    'wanjiku','achieng','amina','njeri','faith','mercy','grace','cynthia','esther','joy',
    'otieno','kamau','mwangi','kiprop','wafula','omondi','chebet','barasa','mutua','njoroge',
    'shiro','zawadi','baraka','imani','salim','halima','rashid','abdi','yusuf','fatuma'];
  styles text[] := array['{n}_254','{n}.ke','{n}{d}','{n}_{d}','mr{n}','ms{n}','{n}official','the{n}'];
  lines  text[] := array[
    'buy buy buy 🚀','green day today 💚','nikona x3 🔥','cashing out now','let''s gooo',
    'this curve is climbing','sell before it drops','easy money','🚀🚀🚀','patience pays',
    'who else is up?','x5 incoming','hold hold hold','just hit my target 🎯','lucky streak fr',
    'down bad lol','back to back wins','trust the process','KES flowing 💸','one more trade',
    'this is the way','calling a green run','sold at the top 😎','almost got x5','GG everyone',
    'feeling lucky today','small stake big win','the dip is a gift','loading another','🤑🤑'];
  n int := 600;                 -- > 500 of each, with margin
  i int; hk int;
  nm text; st text; d int; uname text; k text; amt bigint; mult numeric; msg text; ts timestamptz;
begin
  -- Activity feed
  if (select count(*) from public.activity_feed where is_simulated) = 0 then
    for i in 1..n loop
      nm := names[ (('x'||substr(md5(i::text||'name'),1,7))::bit(28)::int % array_length(names,1)) + 1 ];
      st := styles[ (('x'||substr(md5(i::text||'style'),1,7))::bit(28)::int % array_length(styles,1)) + 1 ];
      d  := (('x'||substr(md5(i::text||'d'),1,7))::bit(28)::int % 999) + 1;
      uname := replace(replace(st,'{n}',nm),'{d}', d::text);
      hk := ('x'||substr(md5(i::text||'kind'),1,7))::bit(28)::int % 100;   -- weighted: 50 win / 30 wd / 15 bonus / 5 signup
      if    hk < 50 then k := 'win';
      elsif hk < 80 then k := 'withdrawal';
      elsif hk < 95 then k := 'bonus';
      else               k := 'signup';
      end if;
      if    k = 'withdrawal' then amt := 50000 + (('x'||substr(md5(i::text||'amt'),1,7))::bit(28)::int % 4950001);  -- KES 500–50,000
      elsif k = 'win'        then amt := 10000 + (('x'||substr(md5(i::text||'amt'),1,7))::bit(28)::int % 2490001);  -- KES 100–25,000
      elsif k = 'bonus'      then amt := 1000  + (('x'||substr(md5(i::text||'amt'),1,7))::bit(28)::int % 49001);    -- KES 10–500
      else                        amt := null;
      end if;
      ts := now() - ((('x'||substr(md5(i::text||'ts'),1,7))::bit(28)::int % (14*24*3600)) * interval '1 second');   -- last 14 days
      if    k = 'withdrawal' then msg := '🎉 CONGRATULATIONS @'||uname||' on withdrawal of KES '||to_char(amt/100.0,'FM999,999,990.00');
      elsif k = 'win'        then
        mult := 1.10 + ((('x'||substr(md5(i::text||'mult'),1,7))::bit(28)::int % 391) / 100.0);                     -- ×1.10–×5.00
        msg := '@'||uname||' just won KES '||to_char(amt/100.0,'FM999,999,990.00')||' on a ×'||to_char(mult,'FM990.00')||' trade';
      elsif k = 'bonus'      then msg := 'BONUS of KES '||to_char(amt/100.0,'FM999,999,990.00')||' issued to @'||uname;
      else                        msg := '@'||uname||' just joined Invest254';
      end if;
      insert into public.activity_feed(kind, username, amount, is_simulated, message, created_at)
        values (k, uname, amt, true, msg, ts);
    end loop;
  end if;

  -- Chat backlog (simulated: user_id = NULL)
  if (select count(*) from public.chat_messages where user_id is null) = 0 then
    for i in 1..n loop
      nm := names[ (('x'||substr(md5(i::text||'cname'),1,7))::bit(28)::int % array_length(names,1)) + 1 ];
      st := styles[ (('x'||substr(md5(i::text||'cstyle'),1,7))::bit(28)::int % array_length(styles,1)) + 1 ];
      d  := (('x'||substr(md5(i::text||'cd'),1,7))::bit(28)::int % 999) + 1;
      uname := replace(replace(st,'{n}',nm),'{d}', d::text);
      msg := lines[ (('x'||substr(md5(i::text||'line'),1,7))::bit(28)::int % array_length(lines,1)) + 1 ];
      ts := now() - ((('x'||substr(md5(i::text||'cts'),1,7))::bit(28)::int % (3*24*3600)) * interval '1 second');  -- last 3 days
      insert into public.chat_messages(user_id, username, message, is_hidden, created_at)
        values (null, uname, msg, false, ts);
    end loop;
  end if;
end
$seed$;
