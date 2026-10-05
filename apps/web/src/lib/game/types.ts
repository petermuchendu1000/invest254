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
    /** Whether the engine will accept a manual close on this brand (false in pool mode). Absent on
     *  an engine that predates the flag, which is read as "no", because a close control that
     *  cannot work is worse than one that is not there. */
    earlyCloseEnabled?: boolean;
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
