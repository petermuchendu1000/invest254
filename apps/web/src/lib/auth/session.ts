import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { MeDto } from '@/lib/api/types';

interface SessionState {
  token: string | null;
  user: MeDto | null;
  setToken: (token: string | null) => void;
  setUser: (user: MeDto | null) => void;
  reset: () => void;
}

/**
 * Auth session. Only the bearer token is persisted (localStorage); the profile
 * (`user`) is re-fetched from GET /auth/me on load so it never goes stale.
 */
export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setToken: (token) => set({ token }),
      setUser: (user) => set({ user }),
      reset: () => set({ token: null, user: null }),
    }),
    {
      name: 'pp-session',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ token: s.token }),
    },
  ),
);
