import PDFDocument from "pdfkit";
import { formatAmount } from "./mpesa.js";
import { eatTimestamp, type StatementDto } from "./marketers.statement.js";

/**
 * The statement as a PDF — the artifact the emailed export actually carries.
 *
 * Built with pdfkit rather than rendered from HTML: a headless browser would mean shipping Chromium
 * in the API image for one document, and this page is a fixed-width table, which is the one layout
 * hand-drawing is good at. pdfkit is pure JavaScript, so the image gains no native dependency.
 *
 * TWO PASSES OVER THE PAGES. "Page 1 of 255" cannot be written until the last page exists, so the
 * document is built with `bufferPages`, then every page is revisited to stamp its header. Writing
 * "Page 1" and hoping is the alternative, and it is wrong on every page but the first.
 *
 * EVERY FIGURE IS THE SERVER'S. Nothing is summed here — the summary covers rows the detail does
 * not carry (docs/65 §2), so a total recomputed from what is printed would disagree with itself the
 * moment the cap bit.
 */

const GREEN = "#2FA84F";
const HEADER_GREEN = "#3FAE5A";
const INK = "#2B2B2B";
const GRID = "#9BC7A6";
const LABEL = "#2FA84F";

const PAGE_MARGIN = 40;
const PAGE_WIDTH = 595.28;          // A4 portrait
const PAGE_HEIGHT = 841.89;
const CONTENT_W = PAGE_WIDTH - PAGE_MARGIN * 2;

/** The detail table's columns, in the reference's order. Widths sum to CONTENT_W. */
const DETAIL_COLS: Array<{ key: string; label: string; w: number; align: "left" | "right" }> = [
  { key: "code", label: "Receipt No.", w: 62, align: "left" },
  { key: "time", label: "Completion Time", w: 92, align: "left" },
  { key: "details", label: "Details", w: 132, align: "left" },
  // Wide enough for "Transaction Status" on ONE line at the header size — it is the widest string
  // in the header row and wrapping it pushed the rule through the middle of the words.
  { key: "status", label: "Transaction Status", w: 70, align: "left" },
  { key: "in", label: "Paid In", w: 50, align: "right" },
  { key: "out", label: "Withdrawn", w: 52, align: "right" },
  { key: "bal", label: "Balance", w: 57, align: "right" },
];

const money = (cents: number): string => formatAmount(cents);

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "15 Oct 2026" — the header block's date form, in EAT. */
export function requestDate(ms: number): string {
  const d = new Date(ms + 3 * 60 * 60 * 1000);
  return `${String(d.getUTCDate()).padStart(2, "0")} ${SHORT_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export interface StatementPdfOptions {
  /**
   * The marketer's own number, UNMASKED, as the reference prints it.
   *
   * Deliberately passed in rather than taken from the DTO, whose `mobileNumber` is masked for the
   * app (docs/58). This document is generated on the server and sent to the marketer's own inbox or
   * one they nominated; it is their number, and the in-app page already shows it whole. No
   * counterparty number appears anywhere, because none is stored.
   */
  mobileNumber: string;
}

export function buildStatementPdf(s: StatementDto, opts: StatementPdfOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: PAGE_MARGIN,
      bufferPages: true,
      info: {
        Title: `M-PESA Statement ${s.periodLabel}`,
        Author: "M-PESA",
        Subject: `Statement ${s.ref}`,
        CreationDate: new Date(s.generatedAtMs),
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      // Leave room at the top of every page for the "Page N of M" header stamped in pass two.
      const TOP = PAGE_MARGIN + 26;
      doc.y = TOP;

      drawTitle(doc);
      drawHeaderBand(doc, s, opts);
      drawSummary(doc, s);
      drawDetail(doc, s, TOP);
      stampPageHeaders(doc);
      doc.end();
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

// ── Sections ──────────────────────────────────────────────────────────────────────────────────────

type Doc = PDFKit.PDFDocument;

function drawTitle(doc: Doc): void {
  doc.font("Helvetica-Bold").fontSize(17).fillColor(GREEN)
    .text("M-PESA STATEMENT", PAGE_MARGIN, doc.y, { width: CONTENT_W, align: "center" });
  doc.moveDown(1.2);
}

function drawHeaderBand(doc: Doc, s: StatementDto, opts: StatementPdfOptions): void {
  const top = doc.y;
  const qrSide = 112;
  const qrX = PAGE_MARGIN + CONTENT_W - qrSide;
  const sealW = 180;
  const sealX = qrX - sealW - 12;

  // Left: the labelled fields.
  // Sized so a full Gmail address fits on one line: the first version wrapped
  // "faithmwende40130@gmail.com" after the "co", which looks like a truncated address.
  const labelW = 80;
  const rows: Array<[string, string]> = [
    ["Customer Name:", s.customerName],
    ["Mobile Number:", opts.mobileNumber],
    ["Email Address:", s.emailAddress ?? "Not set"],
    ["Statement Period:", s.periodLabel],
    // When the statement was ASKED for, which is not the end of the period it covers — a statement
    // pulled in December for the year to October has an October end and a December request date.
    // Printed in the period's own form ("15 Oct 2026"), not ISO: it sits directly under a row that
    // reads "01 Jan 2024 - 15 Oct 2026" and two date formats in one four-row block is a mistake.
    ["Request Date:", requestDate(s.generatedAtMs)],
  ];
  let y = top;
  for (const [label, value] of rows) {
    doc.font("Helvetica").fontSize(7.5).fillColor(LABEL).text(label, PAGE_MARGIN, y, { width: labelW });
    doc.font("Helvetica").fontSize(7.5).fillColor(INK)
      .text(value, PAGE_MARGIN + labelW + 6, y, { width: sealX - PAGE_MARGIN - labelW - 16 });
    y += 17;
  }

  drawSeal(doc, s, sealX, top, sealW);
  drawQr(doc, s, qrX, top, qrSide);

  doc.y = Math.max(y, top + qrSide) + 14;
}

/** The approval box the reference prints between the fields and the QR. */
function drawSeal(doc: Doc, s: StatementDto, x: number, y: number, w: number): void {
  const h = 104;
  doc.save();
  doc.roundedRect(x, y, w, h, 3).lineWidth(0.8).strokeColor(GRID).stroke();
  let ty = y + 8;
  const line = (text: string, size: number, color: string, bold = false): void => {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).fillColor(color)
      .text(text, x + 6, ty, { width: w - 12, align: "center" });
    ty = doc.y + 1.5;
  };
  line(`Approved - ${s.approvalDate}`, 8, GREEN, true);
  line("SAFARICOM CUSTOMER CARE", 6, INK, true);
  line("M-PESA Statement Period:", 6, INK);
  line(s.periodOrdinal, 6.5, INK, true);
  line("www.safaricom.co.ke", 6, GREEN);
  line("P.O BOX 66827 - 00800, NAIROBI", 5.5, INK);
  line("Simple · Transparent · Honest   FOR YOU", 5.5, GREEN, true);
  drawOperatorMark(doc, x + w - 62, y + h - 16);
  doc.font("Helvetica-Bold").fontSize(8).fillColor(GREEN)
    .text("Safaricom", x + 6, y + h - 14, { width: w - 12, align: "right" });
  doc.restore();
}

/** The QR, drawn from the module matrix the statement already carries. */
function drawQr(doc: Doc, s: StatementDto, x: number, y: number, side: number): void {
  const n = s.qr.size;
  if (n <= 0 || s.qr.bits.length !== n * n) return;
  const quiet = 2;
  const step = side / (n + quiet * 2);
  doc.save();
  doc.rect(x, y, side, side).fillColor("#FFFFFF").fill();
  doc.fillColor("#111111");
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (s.qr.bits[row * n + col] !== "1") continue;
      // A hair over one module, so adjacent modules leave no seam at a fractional step.
      doc.rect(x + (col + quiet) * step, y + (row + quiet) * step, step + 0.25, step + 0.25).fill();
    }
  }
  doc.restore();
}

function drawSummary(doc: Doc, s: StatementDto): void {
  doc.font("Helvetica-Bold").fontSize(12).fillColor(GREEN)
    .text("SUMMARY", PAGE_MARGIN, doc.y, { width: CONTENT_W, align: "center" });
  doc.moveDown(0.5);

  const cols = [CONTENT_W - 190, 95, 95];
  const rowH = 13;
  let y = doc.y;

  const cells = (values: string[], opts: { bg?: string; color: string; bold: boolean }): void => {
    if (opts.bg) doc.rect(PAGE_MARGIN, y, CONTENT_W, rowH).fillColor(opts.bg).fill();
    let x = PAGE_MARGIN;
    values.forEach((v, i) => {
      doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(7).fillColor(opts.color)
        .text(v, x + 4, y + 3.5, { width: cols[i]! - 8, align: i === 0 ? "left" : "right" });
      x += cols[i]!;
    });
    doc.rect(PAGE_MARGIN, y, CONTENT_W, rowH).lineWidth(0.4).strokeColor(GRID).stroke();
    y += rowH;
  };

  cells(["TRANSACTION TYPE", "PAID IN", "PAID OUT"], { bg: HEADER_GREEN, color: "#FFFFFF", bold: true });
  for (const r of s.summary) {
    cells([`${r.type}:`, money(r.paidInCents), money(r.paidOutCents)], { color: INK, bold: false });
  }
  cells(["TOTAL:", money(s.totalPaidInCents), money(s.totalPaidOutCents)], { color: INK, bold: true });

  doc.y = y + 16;
}

function drawDetail(doc: Doc, s: StatementDto, topY: number): void {
  doc.font("Helvetica-Bold").fontSize(12).fillColor(GREEN)
    .text("DETAILED STATEMENT", PAGE_MARGIN, doc.y, { width: CONTENT_W, align: "center" });
  doc.moveDown(0.5);

  if (s.detail.length === 0) {
    doc.font("Helvetica").fontSize(8).fillColor(INK)
      .text("No transactions in this period.", PAGE_MARGIN, doc.y, { width: CONTENT_W, align: "center" });
    return;
  }

  const BOTTOM = PAGE_HEIGHT - PAGE_MARGIN;
  let y = doc.y;

  const header = (): void => {
    doc.rect(PAGE_MARGIN, y, CONTENT_W, 14).fillColor(HEADER_GREEN).fill();
    let x = PAGE_MARGIN;
    for (const c of DETAIL_COLS) {
      doc.font("Helvetica-Bold").fontSize(6).fillColor("#FFFFFF")
        .text(c.label, x + 3, y + 4.5, { width: c.w - 6, align: "left" });
      x += c.w;
    }
    doc.rect(PAGE_MARGIN, y, CONTENT_W, 14).lineWidth(0.4).strokeColor(GRID).stroke();
    y += 14;
  };

  header();
  for (const r of s.detail) {
    const values: Record<string, string> = {
      code: r.code,
      time: eatTimestamp(r.atMs),
      details: r.details,
      status: r.status,
      in: r.paidInCents > 0 ? money(r.paidInCents) : "",
      out: r.withdrawnCents > 0 ? money(r.withdrawnCents) : "",
      bal: money(r.balanceCents),
    };
    // Measured BEFORE anything is drawn: the Details column wraps, and a row half on one page and
    // half on the next is the classic table-in-a-PDF bug.
    const detailsCol = DETAIL_COLS[2]!;
    doc.font("Helvetica").fontSize(6.2);
    const textH = doc.heightOfString(values.details ?? "", { width: detailsCol.w - 6 });
    const rowH = Math.max(13, textH + 6);

    if (y + rowH > BOTTOM) {
      doc.addPage();
      y = topY;
      header();
    }

    let x = PAGE_MARGIN;
    for (const c of DETAIL_COLS) {
      doc.font("Helvetica").fontSize(6.2).fillColor(INK)
        .text(values[c.key] ?? "", x + 3, y + 3, { width: c.w - 6, align: c.align });
      x += c.w;
    }
    doc.rect(PAGE_MARGIN, y, CONTENT_W, rowH).lineWidth(0.3).strokeColor(GRID).stroke();
    y += rowH;
  }

  if (s.truncated) {
    if (y + 20 > BOTTOM) { doc.addPage(); y = topY; }
    doc.font("Helvetica-Oblique").fontSize(6.5).fillColor(INK)
      .text(
        `Showing the most recent ${s.detail.length} of ${s.txnCount} transactions. ` +
          `The summary above covers all ${s.txnCount}.`,
        PAGE_MARGIN, y + 6, { width: CONTENT_W, align: "center" },
      );
  }
}

/**
 * Pass two: "Page N of M" on every page, now that M is known.
 *
 * Also the rule under it, which is drawn here rather than in pass one so it cannot be missed on a
 * page the detail table added for itself.
 */
function stampPageHeaders(doc: Doc): void {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.font("Helvetica").fontSize(7).fillColor(INK)
      .text(`Page ${i + 1} of ${range.count}`, PAGE_MARGIN, PAGE_MARGIN - 4,
        { width: CONTENT_W, align: "right" });
    doc.moveTo(PAGE_MARGIN, PAGE_MARGIN + 8).lineTo(PAGE_MARGIN + CONTENT_W, PAGE_MARGIN + 8)
      .lineWidth(0.6).strokeColor(GRID).stroke();
  }
}

/** The operator's ribbon mark, drawn beside the wordmark in the seal. Two arcs, as the brand has. */
function drawOperatorMark(doc: Doc, x: number, y: number): void {
  doc.save();
  doc.lineCap("round");
  doc.moveTo(x, y + 10).bezierCurveTo(x + 1, y - 1, x + 8, y - 4, x + 15, y + 10)
    .lineWidth(2.6).strokeColor(GREEN).stroke();
  doc.moveTo(x + 4, y + 12).bezierCurveTo(x + 5, y + 4, x + 9, y + 3, x + 12, y + 12)
    .lineWidth(2.2).strokeColor("#E1251B").stroke();
  doc.restore();
}
