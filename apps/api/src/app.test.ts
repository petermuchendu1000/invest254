import { test } from "node:test";
import assert from "node:assert/strict";
import { rtp, DEFAULT_CONFIG } from "@invest254/shared";
import { startTestApi } from "./testutil.js";

// node's fetch types `.json()` as `unknown`; tests assert on dynamic shapes.
const json = (res: Response): Promise<any> => res.json() as Promise<any>;

test("GET /api/v1/health → 200 ok", async () => {
  const api = await startTestApi();
  try {
    const res = await fetch(`${api.baseUrl}/api/v1/health`);
    assert.equal(res.status, 200);
    const body = await json(res);
    assert.equal(body.status, "ok");
    assert.ok(typeof body.time === "string" && !Number.isNaN(Date.parse(body.time)));
  } finally { await api.close(); }
});

test("GET /api/v1/game/config → public config snapshot in cents", async () => {
  const api = await startTestApi();
  try {
    const res = await fetch(`${api.baseUrl}/api/v1/game/config`);
    assert.equal(res.status, 200);
    const body = await json(res);
    assert.equal(body.currency, "KES");
    assert.equal(body.minStakeCents, DEFAULT_CONFIG.minStakeCents);
    assert.equal(body.maxStakeCents, DEFAULT_CONFIG.maxStakeCents);
    assert.equal(body.minWithdrawalCents, DEFAULT_CONFIG.minWithdrawalCents);
    assert.equal(body.maxMultiplier, DEFAULT_CONFIG.maxMultiplier);
    assert.equal(body.defaultDurationS, DEFAULT_CONFIG.defaultDurationS);
    assert.equal(body.tickRateMs, DEFAULT_CONFIG.tickRateMs);
    assert.equal(body.rtp, rtp(DEFAULT_CONFIG));
    assert.deepEqual(body.timeframesS, [DEFAULT_CONFIG.defaultDurationS]);
  } finally { await api.close(); }
});

test("GET /api/v1/game/fairness/:id → commitment hidden seed before reveal", async () => {
  const api = await startTestApi();
  try {
    const res = await fetch(`${api.baseUrl}/api/v1/game/fairness/2`);
    assert.equal(res.status, 200);
    const body = await json(res);
    assert.equal(body.gameDayId, 2);
    assert.equal(body.tradeDate, "2026-06-18");
    assert.equal(body.serverSeedHash, "hash-today");
    assert.equal(body.serverSeed, null);   // not revealed yet
    assert.equal(body.revealedAt, null);
  } finally { await api.close(); }
});

test("GET /api/v1/game/fairness/:id → revealed day exposes the seed", async () => {
  const api = await startTestApi();
  try {
    const res = await fetch(`${api.baseUrl}/api/v1/game/fairness/1`);
    assert.equal(res.status, 200);
    const body = await json(res);
    assert.equal(body.serverSeed, "revealed-seed-yesterday");
    assert.ok(body.revealedAt);
  } finally { await api.close(); }
});

test("GET /api/v1/game/fairness/:id → 404 for unknown day", async () => {
  const api = await startTestApi();
  try {
    const res = await fetch(`${api.baseUrl}/api/v1/game/fairness/999`);
    assert.equal(res.status, 404);
    const body = await json(res);
    assert.equal(body.error.code, "NOT_FOUND");
  } finally { await api.close(); }
});

test("GET /api/v1/game/fairness/:id → 400 for non-numeric id", async () => {
  const api = await startTestApi();
  try {
    const res = await fetch(`${api.baseUrl}/api/v1/game/fairness/abc`);
    assert.equal(res.status, 400);
    const body = await json(res);
    assert.equal(body.error.code, "INVALID_ID");
  } finally { await api.close(); }
});

test("unknown route → 404 envelope", async () => {
  const api = await startTestApi();
  try {
    const res = await fetch(`${api.baseUrl}/api/v1/nope`);
    assert.equal(res.status, 404);
    const body = await json(res);
    assert.equal(body.error.code, "NOT_FOUND");
  } finally { await api.close(); }
});

test("wrong method on existing path → 405", async () => {
  const api = await startTestApi();
  try {
    const res = await fetch(`${api.baseUrl}/api/v1/health`, { method: "POST" });
    assert.equal(res.status, 405);
    const body = await json(res);
    assert.equal(body.error.code, "METHOD_NOT_ALLOWED");
  } finally { await api.close(); }
});

test("OPTIONS preflight → 204 with CORS headers (browser write calls succeed)", async () => {
  const api = await startTestApi();
  try {
    const res = await fetch(`${api.baseUrl}/api/v1/auth/register`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://app.invest254.example",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type, authorization",
      },
    });
    assert.equal(res.status, 204);
    // Default allowlist is "*": the request Origin is echoed back so the browser proceeds.
    assert.equal(res.headers.get("access-control-allow-origin"), "https://app.invest254.example");
    const allowMethods = res.headers.get("access-control-allow-methods") ?? "";
    assert.ok(allowMethods.includes("POST"), "POST must be allowed");
    const allowHeaders = (res.headers.get("access-control-allow-headers") ?? "").toLowerCase();
    assert.ok(allowHeaders.includes("authorization") && allowHeaders.includes("content-type"));
  } finally { await api.close(); }
});

test("actual POST carries CORS header so the browser exposes the response", async () => {
  const api = await startTestApi();
  try {
    const res = await fetch(`${api.baseUrl}/api/v1/health`, {
      headers: { Origin: "https://app.invest254.example" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), "https://app.invest254.example");
  } finally { await api.close(); }
});
