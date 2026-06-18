// ============================================================
// Excel Helper — ExcelJS 기반 내보내기 / 가져오기
//
// 🔐 C1 보안 fix (2026-05-21):
//   xlsx (SheetJS Community) 의 Prototype Pollution + ReDoS 취약점 (fix 미제공)
//   → exceljs (활발 유지, 0 CVE) 로 교체.
//
// ⚠️ API 변경: 기존 동기 함수 → **async (Promise)** — 호출측 `await` 필요.
//   exceljs 가 워크북 (de)serialization 을 비동기로 수행.
// ============================================================
const ExcelJS = require('exceljs');

/**
 * rows (객체 배열) → Excel Buffer
 * @param {Array<{key, label}>} columns  — 순서대로 출력할 컬럼 정의
 * @param {Array<Object>}        rows     — 데이터 행
 * @param {string}               sheetName
 * @returns {Promise<Buffer>}
 */
async function toExcelBuffer(columns, rows, sheetName = 'Sheet1') {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);

  // 컬럼 정의 (헤더 + key + width 자동 조정)
  ws.columns = columns.map(c => {
    const headerLen = String(c.label || '').length;
    const dataMax = rows.reduce((max, r) => {
      const v = r[c.key];
      const len = v === null || v === undefined ? 0 : String(v).length;
      return Math.max(max, len);
    }, 0);
    return {
      header: c.label,
      key: c.key,
      width: Math.min(Math.max(headerLen, dataMax) + 2, 50),
    };
  });

  // 데이터 행 추가 (null/undefined → 빈 문자열)
  rows.forEach(row => {
    const cleaned = {};
    columns.forEach(c => {
      const v = row[c.key];
      cleaned[c.key] = v === null || v === undefined ? '' : v;
    });
    ws.addRow(cleaned);
  });

  // ArrayBuffer → Node Buffer
  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab);
}

/**
 * Excel Buffer → 객체 배열 (첫 번째 행 = 헤더)
 * 기존 xlsx 의 sheet_to_json({ defval: '' }) 동등 동작
 * @returns {Promise<Array<Object>>}
 */
async function fromExcelBuffer(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];

  // 첫 행 = 헤더, 나머지 = 데이터
  const headerRow = ws.getRow(1);
  const headers = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber - 1] = String(cell.value ?? '').trim();
  });

  const out = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const obj = {};
    let hasAny = false;
    headers.forEach((key, i) => {
      if (!key) return;
      const raw = row.getCell(i + 1).value;
      let v;
      if (raw === null || raw === undefined) {
        v = '';
      } else if (raw instanceof Date) {
        v = raw; // 날짜 객체 (cellDates 기본 동작)
      } else if (typeof raw === 'object' && raw.text !== undefined) {
        // 하이퍼링크/리치텍스트
        v = raw.text;
      } else if (typeof raw === 'object' && raw.result !== undefined) {
        // 공식 (formula) 의 계산 결과
        v = raw.result;
      } else {
        v = raw;
      }
      obj[key] = v;
      if (v !== '' && v !== null && v !== undefined) hasAny = true;
    });
    if (hasAny) out.push(obj);
  }
  return out;
}

/**
 * res 에 Excel 파일 응답 전송 (동기 — 단순 헤더 + send)
 */
function sendExcel(res, buffer, filename) {
  res.setHeader(
    'Content-Disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(filename)}.xlsx`
  );
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Length', buffer.length);
  res.send(buffer);
}

module.exports = { toExcelBuffer, fromExcelBuffer, sendExcel };
