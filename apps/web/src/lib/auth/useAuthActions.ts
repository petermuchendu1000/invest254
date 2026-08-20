'use client';

import { api, type RegisterInput } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { useSession } from '@/lib/auth/session';
import { roleFromToken } from '@/lib/auth/token';
import { useBrand } from '@/lib/brand/BrandProvider';
import { useWelcomeBonusFx } from '@/lib/game/welcomeBonusFx';

/** 200 KES welcome bonus granted at registration (fn_register_user, migration 0095), in cents. */
const WELCOME_BONUS_CENTS = 20000;

export function useAuthActions() {
  const setToken = useSession((s) => s.setToken);
  const setUser = useSession((s) => s.setUser);
  const reset = useSession((s) => s.reset);
  // The brand this request/host resolved to (SSR-injected via BrandProvider). Every auth call
  // carries it so the shared API scopes the account + token to the right brand (GAP 1 fix). The
  // API is one host for all domains, so without this a player on any brand pools into site #1.
  const brand = useBrand();
  const celebrateWelcome = useWelcomeBonusFx((s) => s.show);

  async function login(phone: string, password: string) {
    const res = await api.login({ phone, password, site: brand.slug });
    setToken(res.token);
    setUser(await api.me(res.token));
    return res;
  }

  async function register(input: RegisterInput) {
    // Respect an explicit site if a caller ever sets one; otherwise bind to the resolved brand.
    const res = await api.register({ ...input, site: input.site ?? brand.slug });
    setToken(res.token);
    setUser(await api.me(res.token));
    // Celebrate the 200 KES welcome bonus granted server-side at registration (Task 2). Amount is a
    // constant matching fn_register_user (0095); avoids racing the WS balance push for the figure.
    celebrateWelcome(WELCOME_BONUS_CENTS);
    return res;
  }

  async function refresh(token: string) {
    try {
      const me = await api.me(token);
      setUser(me);
      // Heal a stale token whose role claim no longer matches the live role (promotion/demotion).
      if (roleFromToken(token) !== me.role) {
        try {
          const r = await api.refreshToken(token);
          setToken(r.token);
        } catch {
          /* keep existing token; non-fatal */
        }
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) reset();
    }
  }

  function logout() {
    reset();
  }

  return { login, register, refresh, logout };
}
