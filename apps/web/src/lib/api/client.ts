import { env } from '@/lib/env';

/** Standard error envelope from the API (docs/05 §8). */
export interface ApiErrorBody {
  error: { code: string; message: string; reasons?: string[] };
}

/** Typed error thrown for any non-2xx response. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly reasons?: string[];
  constructor(status: number, code: string, message: string, reasons?: string[]) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    if (reasons && reasons.length > 0) this.reasons = reasons;
  }
}

export type QueryValue = string | number | boolean | undefined;

export interface RequestOptions {
  method?: string;
  body?: unknown;
  token?: string | null;
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
}

function buildQuery(query?: Record<string, QueryValue>): string {
  if (!query) return '';
  const pairs = Object.entries(query)
    .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return pairs.length > 0 ? `?${pairs.join('&')}` : '';
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Typed fetch against the Invest254 REST API. Injects the bearer token,
 * serialises JSON, and normalises the error envelope into an ApiError.
 */
export async function apiFetch<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, token, query, signal } = opts;
  const base = env.apiBaseUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  if (signal) init.signal = signal;

  const res = await fetch(`${base}${path}${buildQuery(query)}`, init);
  const text = await res.text();
  const data = text ? safeJson(text) : null;

  if (!res.ok) {
    const envelope = data as ApiErrorBody | null;
    const code = envelope?.error?.code ?? `HTTP_${res.status}`;
    const message = envelope?.error?.message ?? (res.statusText || 'Request failed');
    throw new ApiError(res.status, code, message, envelope?.error?.reasons);
  }
  return data as T;
}
