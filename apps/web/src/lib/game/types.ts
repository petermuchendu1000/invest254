import type { Tick } from '@invest254/shared/types';

export type { Tick };

/** WS envelope (engine: { type, data, ts }). */
export interface Envelope {
  type: string;
  data: unknown;
  ts: number;
}

export interface HelloData {
  serverTime: number;
  serverSeedHash: string;
  tradeDate: string;
  gameConfig: {
    minStakeCents: number;
    maxMultiplier: number;
    defaultDurationS: number;
    tickRateMs: number;
  };
}

export interface FairnessData {
  serverSeedHash: string;
  tradeDate: string;
}

export interface OnlineData {
  count: number;
}

export type ConnStatus = 'connecting' | 'open' | 'closed';
