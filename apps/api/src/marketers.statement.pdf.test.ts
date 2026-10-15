import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { buildStatementPdf, requestDate } from "./marketers.statement.pdf.js";
import { sealDate, sealPeriod, statementQr, type StatementDto, type StatementDetailRow } from "./marketers.statement.js";

/**
 * The emailed statement, as a PDF.
 *
 * Asserted against the REAL artifact rather than a build with compression turned off: pdfkit
 * deflates its content streams, so the text is recovered by inflating them here. A test seam that
 * produced an uncompressed document would be testing a file nobody receives.
 */

/**
 * The visible text of the document.
 *
 * Each page is a deflated content stream, and pdfkit shows text as a KERNED TJ array of hex
 * strings — `[<4d2d5045534120 ...> 90 <41> ...] TJ` — so the hex runs of one operator are
 * reassembled into the word they spell and the kerning numbers between them dropped. Reading the
 * streams raw (the first version of this helper) finds nothing at all, which looked exactly like a
 * PDF with no text in it.
 */
function pdfText(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  const re = /stream\r?\n([\s\S]*?)endstream/g;
  let out = "";
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    let page: string;
    try { page = inflateSync(Buffer.from(m[1]!, "latin1")).toString("latin1"); } catch { continue; }
    out += page.replace(/\[([^\]]*)\]\s*TJ/g, (_all, arr: string) => {
      let word = "";
      for (const hex of arr.matchAll(/<([0-9a-fA-F]*)>/g)) {
        word += Buffer.from(hex[1]!, "hex").toString("latin1");
      }
      return `${word}\n`;
    });
  }
  return out;
}

const pageCount = (pdf: Buffer): number => (pdf.toString("latin1").match(/\/Type \/Page[^s]/g) ?? []).length;

function row(i: number, over: Partial<StatementDetailRow> = {}): StatementDetailRow {
  return {
    code: `UJEJ0AN${String(i).padStart(3, "0")}`,
    atMs: Date.parse("2026-10-14T18:24:50Z") - i * 3_600_000,
    entryType: "transfer_out",
    details: "Customer Transfer to - PETER MUCHENDU",
    status: "Completed",
    paidInCents: 0,
    withdrawnCents: 500,
    balanceCents: 100_000 - i * 100,
    ...over,
  };
}

const PERIOD = "01 Jan 2024 - 15 Oct 2026";
function dto(over: Partial<StatementDto> = {}): StatementDto {
  const base: StatementDto = {
    ref: "UJEJ0ANPDS",
    customerName: "Faith Mwende Mutiso",
    mobileNumber: "0748****157",
    emailAddress: "faithmwende40130@gmail.com",
    periodFrom: "2024-01-01",
    periodTo: "2026-10-15",
    periodLabel: PERIOD,
    approvalDate: sealDate(Date.parse("2026-10-15T06:00:00Z")),
    periodOrdinal: sealPeriod(PERIOD),
    generatedAtMs: Date.parse("2026-10-15T06:00:00Z"),
    summary: [
      { type: "SEND MONEY", paidInCents: 0, paidOutCents: 224_042_700 },
      { type: "RECEIVED MONEY", paidInCents: 93_124_595, paidOutCents: 0 },
      { type: "AGENT DEPOSIT", paidInCents: 668_000, paidOutCents: 0 },
      { type: "AGENT WITHDRAWAL", paidInCents: 0, paidOutCents: 8_557_100 },
      { type: "LIPA NA M-PESA (PAY BILL)", paidInCents: 2_562_500, paidOutCents: 16_237_813 },
      { type: "LIPA NA M-PESA (BUY GOODS)", paidInCents: 4_585_539, paidOutCents: 13_341_800 },
      { type: "OTHERS", paidInCents: 197_401_675, paidOutCents: 36_974_200 },
    ],
    totalPaidInCents: 299_174_471,
    totalPaidOutCents: 299_153_613,
    txnCount: 3,
    detail: [row(0), row(1), row(2)],
    truncated: false,
    qr: statementQr({
      ref: "UJEJ0ANPDS", mobileNumber: "0748****157", periodLabel: PERIOD,
      totalPaidInCents: 299_174_471, totalPaidOutCents: 299_153_613, txnCount: 3,
    }),
    ...over,
  };
  return base;
}
const OPTS = { mobileNumber: "0748057157" };

test("it is a PDF, and a well-formed one", async () => {
  const pdf = await buildStatementPdf(dto(), OPTS);
  assert.ok(pdf.length > 3_000, `suspiciously small: ${pdf.length} bytes`);
  assert.equal(pdf.subarray(0, 5).toString("latin1"), "%PDF-");
  assert.ok(pdf.toString("latin1").trimEnd().endsWith("%%EOF"));
  // The page tree's own count must agree with the pages actually written.
  const declared = Number(/\/Count (\d+)/.exec(pdf.toString("latin1"))?.[1] ?? -1);
  assert.equal(declared, pageCount(pdf));
});

test("the header band prints every field the reference prints", async () => {
  const text = pdfText(await buildStatementPdf(dto(), OPTS));
  assert.match(text, /M-PESA STATEMENT/);
  assert.match(text, /Customer Name:/);
  assert.match(text, /Faith Mwende Mutiso/);
  assert.match(text, /Mobile Number:/);
  assert.match(text, /Email Address:/);
  assert.match(text, /faithmwende40130@gmail\.com/);
  assert.match(text, /Statement Period:/);
  assert.match(text, /01 Jan 2024 - 15 Oct 2026/);
  // In the period's own form, not ISO: it sits directly under "01 Jan 2024 - 15 Oct 2026", and two
  // date formats in one four-row block is a mistake a reader has to stop and resolve.
  assert.match(text, /Request Date:/);
  assert.match(text, /15 Oct 2026/);
});

test("the request date is the day the statement was asked for, in EAT", () => {
  assert.equal(requestDate(Date.parse("2026-10-15T06:00:00Z")), "15 Oct 2026");
  assert.equal(requestDate(Date.parse("2026-01-02T00:00:00Z")), "02 Jan 2026");
  // 22:30 UTC is already tomorrow in Nairobi, like every other date on the page.
  assert.equal(requestDate(Date.parse("2026-10-15T22:30:00Z")), "16 Oct 2026");
});

test("the mobile number is the one PASSED IN, not the masked one on the DTO", async () => {
  // The DTO's copy is masked for the app (docs/58). This document is generated on the server and
  // addressed to the marketer, so it prints their own number whole — as the reference does.
  const text = pdfText(await buildStatementPdf(dto(), OPTS));
  assert.match(text, /0748057157/);
  assert.ok(!text.includes("0748****157"), "the masked copy was printed instead of the real one");
});

test("an unset email says so rather than printing an empty row", async () => {
  const text = pdfText(await buildStatementPdf(dto({ emailAddress: null }), OPTS));
  assert.match(text, /Email Address:/);
  assert.match(text, /Not set/);
});

test("the approval seal carries its own ordinal dates", async () => {
  const text = pdfText(await buildStatementPdf(dto(), OPTS));
  assert.match(text, /Approved - 15th October 2026/);
  assert.match(text, /SAFARICOM CUSTOMER CARE/);
  assert.match(text, /1st Jan 2024 - 15th Oct 2026/);
  assert.match(text, /www\.safaricom\.co\.ke/);
  assert.match(text, /P\.O BOX 66827 - 00800, NAIROBI/);
});

test("the summary prints all eight rows with a colon, and the totals", async () => {
  const text = pdfText(await buildStatementPdf(dto(), OPTS));
  assert.match(text, /SUMMARY/);
  for (const t of ["SEND MONEY:", "RECEIVED MONEY:", "AGENT DEPOSIT:", "AGENT WITHDRAWAL:",
                   "LIPA NA M-PESA \\(PAY BILL\\):", "LIPA NA M-PESA \\(BUY GOODS\\):", "OTHERS:", "TOTAL:"]) {
    assert.match(text, new RegExp(t), `missing summary row ${t}`);
  }
  // The figures themselves, grouped as the reference groups them.
  assert.match(text, /2,240,427\.00/);
  assert.match(text, /2,991,744\.71/);
  assert.match(text, /2,991,536\.13/);
});

test("the detail table has the reference's seven columns, Transaction Status included", async () => {
  const text = pdfText(await buildStatementPdf(dto(), OPTS));
  assert.match(text, /DETAILED STATEMENT/);
  for (const h of ["Receipt No.", "Completion Time", "Details", "Transaction Status", "Paid In", "Withdrawn", "Balance"]) {
    assert.match(text, new RegExp(h.replace(/\./g, "\\.")), `missing column ${h}`);
  }
  assert.match(text, /UJEJ0AN000/);
  assert.match(text, /Customer Transfer to - PETER MUCHENDU/);
  assert.match(text, /Completed/);
  // Sortable 24-hour timestamps, not the receipt's friendlier "9:24 PM" form.
  assert.match(text, /2026-10-14 21:24:50/);
});

test("a long period paginates, and every page says which of how many it is", async () => {
  const many = Array.from({ length: 300 }, (_, i) => row(i));
  const pdf = await buildStatementPdf(dto({ detail: many, txnCount: 300 }), OPTS);
  const pages = pageCount(pdf);
  assert.ok(pages > 5, `expected several pages, got ${pages}`);

  const text = pdfText(pdf);
  // "Page N of M" on every page, with the SAME M — the whole reason for the second pass.
  for (let i = 1; i <= pages; i++) {
    assert.match(text, new RegExp(`Page ${i} of ${pages}`), `page ${i} is not stamped`);
  }
  assert.ok(!text.includes(`of ${pages + 1}`), "a page claims a total that does not exist");
  // The column headers repeat on every page, or the later ones are unreadable.
  assert.equal((text.match(/Receipt No\./g) ?? []).length, pages);
});

test("a wrapping row is given the height it needs, so it cannot be drawn over the next one", async () => {
  // The first version of this test only checked that every receipt number appeared once, which a
  // FIXED row height also satisfies — the text simply overdraws the row below it. What a fixed
  // height cannot do is change the page count, so that is what this asserts.
  const short = Array.from({ length: 120 }, (_, i) => row(i, { details: "Airtime Purchase" }));
  const long = Array.from({ length: 120 }, (_, i) => row(i, {
    details: "Funds received from - ROSELINE KIBURI AND A DELIBERATELY LONG COUNTERPARTY NAME THAT WRAPS ONTO SEVERAL LINES",
  }));
  const shortPages = pageCount(await buildStatementPdf(dto({ detail: short, txnCount: 120 }), OPTS));
  const longPdf = await buildStatementPdf(dto({ detail: long, txnCount: 120 }), OPTS);
  const longPages = pageCount(longPdf);
  assert.ok(
    longPages > shortPages,
    `wrapping rows took ${longPages} pages and single-line rows took ${shortPages} — the row height is not being measured`,
  );

  const text = pdfText(longPdf);
  // THE PRECISE SIGNATURE. If a row is not measured before it is drawn, pdfkit reaches the bottom
  // mid-row and adds a page BY ITSELF — a page this code never knew about and so never gave column
  // headers to. One header per page means every break was this code's own, taken between rows.
  assert.equal(
    (text.match(/Receipt No\./g) ?? []).length, longPages,
    "a page of the detail table has no column headers, so the table broke mid-row",
  );

  // …and still exactly once each, so nothing is drawn twice at the break.
  for (let i = 0; i < 120; i++) {
    const code = `UJEJ0AN${String(i).padStart(3, "0")}`;
    assert.equal((text.match(new RegExp(code, "g")) ?? []).length, 1, `${code} is not printed exactly once`);
  }
});

test("an empty period produces a statement that says so, not a blank table", async () => {
  const text = pdfText(await buildStatementPdf(dto({ detail: [], txnCount: 0, truncated: false }), OPTS));
  assert.match(text, /No transactions in this period\./);
  assert.match(text, /SUMMARY/);          // the summary is still printed, all zeros
  assert.match(text, /TOTAL:/);
});

test("a truncated statement says what the detail is short of", async () => {
  const text = pdfText(await buildStatementPdf(dto({ txnCount: 4_000, truncated: true }), OPTS));
  assert.match(text, /Showing the most recent 3 of 4000 transactions/);
  assert.match(text, /summary above covers all 4000/);
});

test("the document's own metadata names the statement", async () => {
  const raw = (await buildStatementPdf(dto(), OPTS)).toString("latin1");
  assert.match(raw, /M-PESA Statement 01 Jan 2024 - 15 Oct 2026/);
  assert.match(raw, /Statement UJEJ0ANPDS/);
});

test("ordinal dates: the teens are the trap", () => {
  const at = (iso: string): number => Date.parse(iso);
  assert.equal(sealDate(at("2026-10-15T06:00:00Z")), "15th October 2026");
  assert.equal(sealDate(at("2026-10-01T06:00:00Z")), "1st October 2026");
  assert.equal(sealDate(at("2026-10-02T06:00:00Z")), "2nd October 2026");
  assert.equal(sealDate(at("2026-10-03T06:00:00Z")), "3rd October 2026");
  assert.equal(sealDate(at("2026-10-11T06:00:00Z")), "11th October 2026");
  assert.equal(sealDate(at("2026-10-12T06:00:00Z")), "12th October 2026");
  assert.equal(sealDate(at("2026-10-13T06:00:00Z")), "13th October 2026");
  assert.equal(sealDate(at("2026-10-21T06:00:00Z")), "21st October 2026");
  // EAT, like everything else on the page: 22:30 UTC is already tomorrow in Nairobi.
  assert.equal(sealDate(at("2026-10-15T22:30:00Z")), "16th October 2026");
});

test("the seal restates the period in ordinals, and leaves everything else alone", () => {
  assert.equal(sealPeriod("01 Jan 2024 - 15 Oct 2026"), "1st Jan 2024 - 15th Oct 2026");
  assert.equal(sealPeriod("02 Feb 2026 - 03 Mar 2026"), "2nd Feb 2026 - 3rd Mar 2026");
  assert.equal(sealPeriod("11 Jun 2026 - 12 Jun 2026"), "11th Jun 2026 - 12th Jun 2026");
  assert.equal(sealPeriod("21 Dec 2025 - 22 Dec 2025"), "21st Dec 2025 - 22nd Dec 2025");
});
