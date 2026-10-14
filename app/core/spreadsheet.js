const zlib = require("zlib");

// CSV and Excel (.xlsx) files from rows, with no dependencies (the .xlsx is a small deflated zip).
// columns: [{ key, label, type: 's' text | 'n' number | 'd' date (Date or ISO text) }], rows: [{ key: value }].
const BKK_MS = 7 * 3600000;   // dates are written in Bangkok time
const XLSX_CELL_MAX = 32767;

const bkkText = (v) => {
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isNaN(t) ? String(v) : new Date(t + BKK_MS).toISOString().slice(0, 19).replace("T", " ");
};

// ---- CSV (UTF-8 with BOM so Excel reads Thai text) ----
function csvField(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCsv(columns, rows) {
  const lines = [columns.map((c) => csvField(c.label)).join(",")];
  rows.forEach((r) => {
    lines.push(columns.map((c) => {
      const v = r[c.key];
      return csvField(c.type === "d" && v ? bkkText(v) : v);
    }).join(","));
  });
  return Buffer.from("﻿" + lines.join("\r\n") + "\r\n", "utf8");
}

// One CSV line (no line break) of the columns' values in `row`, for streamed exports.
const csvLine = (columns, row) => columns.map((c) => {
  const v = row[c.key];
  return csvField(c.type === "d" && v ? bkkText(v) : v);
}).join(",");

// ---- XLSX ----
const XML_BAD = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
const xmlText = (s) => String(s).replace(XML_BAD, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const colName = (i) => { let s = ""; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

function cell(v, type, ref, style) {
  if (v === null || v === undefined || v === "") return "";
  const s = style ? ` s="${style}"` : "";
  if (type === "n" && Number.isFinite(Number(v))) return `<c r="${ref}"${s}><v>${Number(v)}</v></c>`;
  if (type === "d") {
    const t = v instanceof Date ? v.getTime() : Date.parse(v);
    const serial = (t + BKK_MS) / 86400000 + 25569;
    if (Number.isFinite(serial) && serial >= 1) return `<c r="${ref}" s="1"><v>${serial}</v></c>`;
  }
  let text = String(v);
  if (text.length > XLSX_CELL_MAX) text = text.slice(0, XLSX_CELL_MAX - 1) + "…";
  return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${xmlText(text)}</t></is></c>`;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files) {
  const d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const out = [], central = [];
  let offset = 0;
  files.forEach(({ name, data }) => {
    const raw = Buffer.from(data, "utf8"), packed = zlib.deflateRawSync(raw), nm = Buffer.from(name, "utf8"), crc = crc32(raw);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
    h.writeUInt16LE(time, 10); h.writeUInt16LE(date, 12); h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(packed.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(nm.length, 26);
    out.push(h, nm, packed);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt16LE(time, 12); c.writeUInt16LE(date, 14); c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(packed.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, nm);
    offset += 30 + nm.length + packed.length;
  });
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat(out.concat([cd, end]));
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** An .xlsx workbook with one sheet: bold frozen header, filter, Bangkok dates as real Excel dates. */
function toXlsx(sheetName, columns, rows) {
  const name = String(sheetName || "Sheet1").replace(/[[\]:*?/\\]/g, "_").slice(0, 31) || "Sheet1";
  const refs = columns.map((c, i) => colName(i));
  const last = refs[refs.length - 1] || "A", lastRow = rows.length + 1;
  const widths = columns.map((c) => c.width || Math.min(40, Math.max(8, String(c.label).length + 2)));
  const body = [`<row r="1">${columns.map((c, i) => cell(c.label, "s", refs[i] + "1", 2)).join("")}</row>`];
  rows.forEach((r, i) => {
    const n = i + 2;
    body.push(`<row r="${n}">${columns.map((c, j) => cell(r[c.key], c.type, refs[j] + n)).join("")}</row>`);
  });
  const sheet = XML_HEAD + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` +
    `<sheetData>${body.join("")}</sheetData><autoFilter ref="A1:${last}${lastRow}"/></worksheet>`;
  const quoted = "'" + name.replace(/'/g, "''") + "'";
  return zip([
    { name: "[Content_Types].xml", data: XML_HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { name: "_rels/.rels", data: XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: "xl/workbook.xml", data: XML_HEAD + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlText(name)}" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">${xmlText(quoted)}!$A$1:$${last}$${lastRow}</definedName></definedNames></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: "xl/styles.xml", data: XML_HEAD + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm:ss"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' },
    { name: "xl/worksheets/sheet1.xml", data: sheet }
  ]);
}

module.exports = { toCsv, toXlsx, bkkText, csvLine };
