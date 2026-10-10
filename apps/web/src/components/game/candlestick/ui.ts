'use client';

import { create } from 'zustand';

/** The candlestick screen's own small pieces of UI state (its How to Trade sheet). */
export const useCandlestickUi = create<{ howToOpen: boolean; setHowTo: (v: boolean) => void }>((set) => ({
  howToOpen: false,
  setHowTo: (howToOpen) => set({ howToOpen }),
}));
