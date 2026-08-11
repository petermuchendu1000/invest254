-- 0009 seed: game_config singleton with MVP parameters
-- house_edge 0.75 (RTP 25%), max x5.0, min stake KES 50 (=5000 cents),
-- max stake KES 50,000 (=5,000,000 cents), 10s round, 150ms ticks, green-bias drift 0.02.
insert into public.game_config
  (id, house_edge, max_multiplier, min_stake, max_stake, default_duration_s, tick_rate_ms, drift_bias, volatility)
values
  (1, 0.75, 5.0, 5000, 5000000, 10, 150, 0.02, 1.0)
on conflict (id) do nothing;

