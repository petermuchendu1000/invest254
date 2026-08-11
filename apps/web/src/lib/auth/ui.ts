import { create } from 'zustand';

export type AuthMode = 'login' | 'register' | 'reset';

interface AuthUiState {
  open: boolean;
  mode: AuthMode;
  openAuth: (mode?: AuthMode) => void;
  close: () => void;
}

export const useAuthUi = create<AuthUiState>((set) => ({
  open: false,
  mode: 'login',
  openAuth: (mode = 'login') => set({ open: true, mode }),
  close: () => set({ open: false }),
}));
