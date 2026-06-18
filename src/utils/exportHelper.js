// =============================================================
// Export Helper — Excel / CSV / JSON 통합 다운로드
//
// 사용:
//   const { sendExport, normalizeFormat } = require('../utils/exportHelper');
//   const fmt = normalizeFormat(req.query.format);  // 'xlsx' | 'csv' | 'json'
//   sendExport(res, { columns, rows, sheetName, filename, format: fmt });
//
// 기능:
//   • Excel — SheetJS 활용 (excelHelper.js 의 toExcelBuffer 재사용)
//   • CSV   — UTF-8 BOM 포함 (한국어 안전), 셀 escape (콤마/줄바꿈/큰따옴표)
//   • JSON  — { columns, exported_at, count, rows } 구조 (BI/통합용)
// =============================================================
'use strict';

const { toExcelBuffer } = require('./excelHelper');

const ALLOWED_FORMATS = new Set(['xlsx', 'csv', 'json']);

function normalizeFormat(raw) {
  const v = String(raw || 'xlsx').toLowerCase();
  return ALLOWED_FORMATS.has(v) ? v : 'xlsx';
}

// CSV 셀 이스케이프 — RFC 4180
function escapeCsvCell(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // 콤마 / 큰따옴표 / 줄바꿈 포함 시 큰따옴표로 감싸고 내부 " 는 "" 로 escape
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function toCsvBuffer(columns, rows) {
  const header = columns.map(c => escapeCsvCell(c.label)).join(',');
  const body = rows.map(row =>
    columns
      .map(c => {
        let v = row[c.key];
        // Date → YYYY-MM-DD 형식
        if (v instanceof Date) v = v.toISOString().slice(0, 10);
        return escapeCsvCell(v);
      })
      .join(',')
  );
  const text = '﻿' + [header, ...body].join('\r\n'); // BOM 포함 — Excel 한글 안전
  return Buffer.from(text, 'utf8');
}

function toJsonBuffer(columns, rows, meta = {}) {
  const cleaned = rows.map(row => {
    const obj = {};
    for (const c of columns) {
      let v = row[c.key];
      if (v instanceof Date) v = v.toISOString();
      obj[c.key] = v === undefined ? null : v;
    }
    return obj;
  });
  const payload = {
    exported_at: new Date().toISOString(),
    count: cleaned.length,
    columns: columns.map(c => ({ key: c.key, label: c.label })),
    ...meta,
    rows: cleaned,
  };
  return Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
}

// 통합 진입점 — format 에 따라 적절한 buffer + 헤더 설정
// async — toExcelBuffer (exceljs) 가 Promise 반환 (C1 보안 fix 2026-05-21)
async function sendExport(
  res,
  { columns, rows, sheetName = 'Sheet1', filename = 'export', format = 'xlsx', meta }
) {
  const fmt = normalizeFormat(format);
  let buffer, contentType, ext;

  if (fmt === 'csv') {
    buffer = toCsvBuffer(columns, rows);
    contentType = 'text/csv; charset=utf-8';
    ext = 'csv';
  } else if (fmt === 'json') {
    buffer = toJsonBuffer(columns, rows, meta);
    contentType = 'application/json; charset=utf-8';
    ext = 'json';
  } else {
    buffer = await toExcelBuffer(columns, rows, sheetName);
    contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    ext = 'xlsx';
  }

  const safeFilename = String(filename).replace(/[\\/:*?"<>|]/g, '_');
  res.setHeader('Content-Type', contentType);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(safeFilename)}.${ext}`
  );
  res.setHeader('Content-Length', buffer.length);
  res.send(buffer);
}

module.exports = {
  normalizeFormat,
  toCsvBuffer,
  toJsonBuffer,
  sendExport,
  ALLOWED_FORMATS: [...ALLOWED_FORMATS],
};
