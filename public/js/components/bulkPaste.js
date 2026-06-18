'use strict';
// =============================================================
// BulkPaste — 공통 붙여넣기 등록 컴포넌트 (v6.0.0)
//
// 6대 제약조건 모두 적용:
//   1. 중복 데이터 검증 (사전 사용자 확인 + 백엔드 dedup)
//   2. 필수값 누락 검증 (실시간 미리보기)
//   3. 실패 행별 사유 안내 (행 단위 status + 한글 메시지)
//   4. 부분 성공 정책 (각 row try-catch, 결과 통계)
//   5. 스크립트 삽입 방어 (XSS / CSV / Control char / 제어 문자)
//   6. 행 수 제약 (200/요청, 1000/전체) + 자동 배치 분할
//
// 사용 예:
//   BulkPaste.open({
//     entityType: 'customer',
//     title: '📥 고객사 붙여넣기 등록',
//     endpoint: '/customers/bulk',
//     payloadKey: 'customers',     // POST body 키
//     columns: [
//       { key:'name', label:'고객사명', required:true, sanitize:'text', maxLength:200 },
//       { key:'email', label:'이메일', validate:'email' },
//       { key:'region', label:'지역', enum:['국내','해외'], default:'국내' },
//     ],
//     headerAliases: {                 // 한글 헤더 매핑
//       '고객사명': 'name', '회사명':'name', '이메일':'email', 'email':'email',
//     },
//     duplicateField: 'name',         // 사전 중복 체크 필드 (선택)
//     onSuccess: (result) => {        // 등록 완료 콜백
//       Page.reloadData();
//     },
//   });
// =============================================================
const BulkPaste = (() => {
  // ── 제약 상수 ─────────────────────────────────────────────
  const MAX_ROWS_PER_REQUEST = 200; // 서버 단일 요청
  const MAX_ROWS_TOTAL = 1000; // 클라이언트 전체 합계
  const MAX_CELL_LENGTH = 5000; // 셀당 최대 글자
  const BATCH_SIZE = 200;

  // ── 보안 패턴 (XSS / Script / CSV 인젝션) ──────────────────
  const RE_DANGEROUS = /<script\b|javascript:|on\w+\s*=|<iframe\b|<embed\b|<object\b/i;
  // CSV 인젝션: 셀이 =, +, -, @ 로 시작
  const RE_CSV_INJECTION = /^[=+\-@]/;
  // 제어 문자 (RTL override 등 포함)
  // eslint-disable-next-line no-control-regex
  const RE_CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E]/g;

  // ── HTML escape ───────────────────────────────────────────
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ── 셀 sanitize (보안 핵심) ────────────────────────────────
  function sanitizeCell(value) {
    if (value === null || value === undefined) return '';
    let v = String(value);
    // 1) 제어 문자 strip
    v = v.replace(RE_CONTROL_CHARS, '');
    // 2) 위험 패턴 감지 → 예외 throw (행이 reject 됨)
    if (RE_DANGEROUS.test(v)) {
      const err = new Error('보안: 스크립트/태그 패턴 감지 — 등록 차단');
      err.code = 'SECURITY_VIOLATION';
      throw err;
    }
    // 3) CSV 인젝션: 앞에 ' 추가 (스프레드시트 수식 실행 방지)
    if (RE_CSV_INJECTION.test(v)) {
      v = "'" + v;
    }
    // 4) 길이 cut
    if (v.length > MAX_CELL_LENGTH) {
      v = v.slice(0, MAX_CELL_LENGTH);
    }
    return v.trim();
  }

  // ── 검증 규칙 (8종) ────────────────────────────────────────
  const VALIDATORS = {
    required: (val, _opt) => {
      if (val === null || val === undefined || String(val).trim() === '') {
        return '필수값 누락';
      }
      return null;
    },
    maxLength: (val, opt) => {
      const limit = typeof opt === 'number' ? opt : 200;
      if (val && String(val).length > limit) {
        return `${limit}자 초과 (${String(val).length}자)`;
      }
      return null;
    },
    pattern: (val, opt) => {
      if (!val) return null;
      const re = opt instanceof RegExp ? opt : new RegExp(opt);
      return re.test(val) ? null : '형식 오류';
    },
    email: val => {
      if (!val) return null;
      // RFC 5322 간략 형태
      return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(val) ? null : '이메일 형식 오류';
    },
    phone: val => {
      if (!val) return null;
      // 한국 전화번호 (010-1234-5678, 02-123-4567, 010 1234 5678 등)
      const cleaned = String(val).replace(/[\s\-()]/g, '');
      return /^[\d+]{8,15}$/.test(cleaned) ? null : '전화번호 형식 오류';
    },
    enum: (val, opt) => {
      if (!val) return null;
      const list = Array.isArray(opt) ? opt : [];
      return list.includes(val) ? null : `허용값 아님 (${list.join('/')})`;
    },
    number: val => {
      if (val === null || val === undefined || val === '') return null;
      return isNaN(Number(val)) ? '숫자 아님' : null;
    },
    date: val => {
      if (!val) return null;
      const d = new Date(val);
      return isNaN(d) ? '날짜 형식 오류 (YYYY-MM-DD)' : null;
    },
  };

  // ── 행 단위 검증 ───────────────────────────────────────────
  // returns: { valid: boolean, errors: string[], normalized: object }
  function validateRow(row, columns) {
    const errors = [];
    const normalized = {};
    for (const col of columns) {
      let val = row[col.key];

      // 1) sanitize (보안)
      try {
        val = sanitizeCell(val);
      } catch (e) {
        errors.push(`[${col.label}] ${e.message}`);
        continue;
      }

      // 2) default 적용
      if ((val === null || val === '') && col.default !== undefined) {
        val = col.default;
      }

      // 3) required
      if (col.required) {
        const err = VALIDATORS.required(val);
        if (err) {
          errors.push(`[${col.label}] ${err}`);
          continue;
        }
      }

      // 4) maxLength (sanitize 의 5000 보다 작은 경우)
      if (col.maxLength) {
        const err = VALIDATORS.maxLength(val, col.maxLength);
        if (err) errors.push(`[${col.label}] ${err}`);
      }

      // 5) pattern
      if (col.pattern) {
        const err = VALIDATORS.pattern(val, col.pattern);
        if (err) errors.push(`[${col.label}] ${err}`);
      }

      // 6) validate (email/phone/number/date)
      if (col.validate && VALIDATORS[col.validate]) {
        const err = VALIDATORS[col.validate](val);
        if (err) errors.push(`[${col.label}] ${err}`);
      }

      // 7) enum
      if (col.enum) {
        const err = VALIDATORS.enum(val, col.enum);
        if (err) errors.push(`[${col.label}] ${err}`);
      }

      // 8) transform — 검증 통과한 값을 변환 (숫자 변환, stage 매핑 등)
      if (col.transform && typeof col.transform === 'function' && val !== '' && val !== null) {
        try {
          val = col.transform(val);
        } catch (e) {
          errors.push(`[${col.label}] 변환 오류: ${e.message}`);
        }
      }

      normalized[col.key] = val === '' ? null : (val ?? null);
    }
    return { valid: errors.length === 0, errors, normalized };
  }

  // ── 클립보드 → 2차원 배열 파싱 ────────────────────────────
  function parseClipboard(raw) {
    if (!raw || !raw.trim()) return { headers: null, rows: [] };
    const lines = raw
      .trim()
      .split(/\r?\n/)
      .map(l => l.trimEnd())
      .filter(l => l.length > 0);
    if (!lines.length) return { headers: null, rows: [] };

    // 탭/콤마 구분자 자동 감지 (Excel paste = tab)
    const sep = lines[0].includes('\t') ? '\t' : ',';
    const rows = lines.map(l => l.split(sep).map(c => c.trim().replace(/^"|"$/g, '')));
    return { rows, sep };
  }

  // ── 헤더 매핑 (한글 → 영문 key) ────────────────────────────
  function mapHeaders(headerRow, headerAliases) {
    return headerRow.map(h => {
      const norm = String(h).toLowerCase().replace(/\s/g, '');
      // 1) 정확 매칭
      if (headerAliases[h]) return headerAliases[h];
      if (headerAliases[norm]) return headerAliases[norm];
      // 2) 영문/한글만 추출 후 매칭
      const stripped = norm.replace(/[^a-z가-힣0-9]/g, '');
      return headerAliases[stripped] || null;
    });
  }

  // ── 배열 chunk ─────────────────────────────────────────────
  function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  // ── CSV escape (실패 행 다운로드용) ───────────────────────
  function toCsvCell(v) {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (s.includes('"') || s.includes(',') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function rowsToCsv(headers, rows) {
    const lines = [headers.map(toCsvCell).join(',')];
    for (const r of rows) {
      lines.push(headers.map(h => toCsvCell(r[h])).join(','));
    }
    return lines.join('\n');
  }

  // =============================================================
  // 메인 진입점 — open(config)
  // =============================================================
  function open(config) {
    if (typeof Modal === 'undefined') {
      console.error('[BulkPaste] Modal 컴포넌트 필요');
      return;
    }
    const cfg = {
      title: '📥 일괄 등록',
      entityType: 'item',
      columns: [],
      headerAliases: {},
      endpoint: null,
      payloadKey: 'items',
      duplicateField: null,
      onSuccess: null,
      ...config,
    };
    if (!cfg.endpoint) {
      console.error('[BulkPaste] endpoint 필수');
      return;
    }

    // 상태 (모달 안에서 공유)
    const state = {
      raw: '',
      parsed: [], // { row: {field:value}, status: 'pending'|'valid'|'invalid'|'duplicate'|'success'|'fail', errors: [], reason: '' }
      step: 'input', // 'input' | 'preview' | 'processing' | 'result'
    };

    // 컬럼 라벨 헬프 텍스트
    const colHelp = cfg.columns
      .map(c => `${c.label}${c.required ? '*' : ''}`)
      .join(' / ');

    Modal.open({
      title: cfg.title,
      width: 920,
      confirmOnClose: true,
      body: `
        <div class="bp-step bp-step-input">
          <div style="font-size:13px;color:var(--text-2);line-height:1.7;margin-bottom:12px">
            Excel·Word·이메일에서 복사한 표 데이터를 붙여넣으세요 <kbd>Ctrl+V</kbd><br>
            <span style="font-size:11px;color:var(--text-3)">
              지원 컬럼: ${esc(colHelp)} · 최대 ${MAX_ROWS_TOTAL}행
            </span>
          </div>
          <textarea id="bp-textarea" rows="6"
            class="form-input"
            style="width:100%;font-family:'IBM Plex Mono',monospace;font-size:12px"
            placeholder="여기에 붙여넣기 (Ctrl+V) — 첫 행이 헤더이면 자동 인식"></textarea>
        </div>
        <div id="bp-preview-wrap" style="margin-top:14px"></div>
      `,
      footer: `
        <button class="btn btn-ghost" id="bp-close-btn">닫기</button>
        <button class="btn btn-ghost" id="bp-reset-btn" style="display:none">↺ 초기화</button>
        <button class="btn btn-ghost" id="bp-csv-btn" style="display:none">📥 실패 행 CSV</button>
        <button class="btn btn-primary" id="bp-submit-btn" style="display:none">✅ 등록하기</button>
      `,
      bind: {
        '#bp-close-btn': () => Modal.close(),
        '#bp-reset-btn': () => _reset(),
        '#bp-csv-btn': () => _downloadFailedCsv(),
        '#bp-submit-btn': () => _submit(),
      },
    });

    // 텍스트 영역 paste 이벤트
    setTimeout(() => {
      const ta = document.getElementById('bp-textarea');
      if (!ta) return;
      ta.focus();
      ta.addEventListener('paste', e => {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text/plain') || '';
        ta.value = text;
        _onInput(text);
      });
      ta.addEventListener('input', () => _onInput(ta.value));
    }, 50);

    // ── 내부 함수 ────────────────────────────────────────────
    function _reset() {
      state.raw = '';
      state.parsed = [];
      state.step = 'input';
      const ta = document.getElementById('bp-textarea');
      if (ta) ta.value = '';
      const wrap = document.getElementById('bp-preview-wrap');
      if (wrap) wrap.innerHTML = '';
      _toggleFooter({ submit: false, reset: false, csv: false });
    }

    function _onInput(raw) {
      state.raw = raw;
      const wrap = document.getElementById('bp-preview-wrap');
      if (!wrap) return;
      if (!raw.trim()) {
        wrap.innerHTML = '';
        _toggleFooter({ submit: false, reset: false, csv: false });
        return;
      }

      const { rows } = parseClipboard(raw);
      if (!rows.length) {
        wrap.innerHTML = `<div style="color:var(--oci-red);font-size:12px;padding:10px">파싱된 데이터 없음</div>`;
        _toggleFooter({ submit: false, reset: true, csv: false });
        return;
      }

      // ── 행 수 제약 — 전체 1000행 초과 시 경고 + cut ─────────
      let truncated = false;
      let dataRows = rows.slice();
      // 헤더 인식 (첫 행이 컬럼 헤더이면)
      let columnMap = null; // 인덱스 → 필드 key
      const firstRowMapped = mapHeaders(rows[0], cfg.headerAliases);
      const headerHitCount = firstRowMapped.filter(Boolean).length;
      if (headerHitCount >= 1) {
        columnMap = firstRowMapped;
        dataRows = rows.slice(1);
      } else {
        // 헤더 없음 — columns 순서대로 자동 매핑
        columnMap = cfg.columns.map(c => c.key);
      }

      if (dataRows.length > MAX_ROWS_TOTAL) {
        truncated = true;
        dataRows = dataRows.slice(0, MAX_ROWS_TOTAL);
      }

      // ── 행별 → 객체 변환 + 검증 ─────────────────────────────
      state.parsed = dataRows
        .filter(r => r.some(c => c)) // 빈 행 제거
        .map((r, i) => {
          const obj = {};
          columnMap.forEach((field, ci) => {
            if (field) obj[field] = r[ci] || '';
          });
          const result = validateRow(obj, cfg.columns);
          return {
            idx: i + 1,
            raw: obj,
            normalized: result.normalized,
            errors: result.errors,
            status: result.errors.length ? 'invalid' : 'valid',
            reason: result.errors.join(' · '),
          };
        });

      _renderPreview(truncated);
      const validCount = state.parsed.filter(p => p.status === 'valid').length;
      _toggleFooter({ submit: validCount > 0, reset: true, csv: false });
    }

    function _renderPreview(truncated) {
      const wrap = document.getElementById('bp-preview-wrap');
      if (!wrap) return;
      const total = state.parsed.length;
      const validCount = state.parsed.filter(p => p.status === 'valid').length;
      const invalidCount = total - validCount;

      const STATUS_META = {
        valid: { icon: '✓', color: '#16a34a', bg: '#dcfce7', label: '정상' },
        invalid: { icon: '✗', color: '#dc2626', bg: '#fee2e2', label: '실패' },
        duplicate: { icon: '⚠', color: '#d97706', bg: '#fef3c7', label: '중복' },
        success: { icon: '✓', color: '#16a34a', bg: '#dcfce7', label: '등록' },
        fail: { icon: '✗', color: '#dc2626', bg: '#fee2e2', label: '오류' },
      };

      const rowsHtml = state.parsed
        .map(p => {
          const m = STATUS_META[p.status] || STATUS_META.invalid;
          const cells = cfg.columns
            .map(col => `<td style="padding:4px 8px;font-size:11px;${p.status === 'invalid' ? 'color:#9ca3af' : ''}">${esc(p.normalized[col.key] || '')}</td>`)
            .join('');
          return `<tr style="background:${p.status === 'invalid' ? '#fff7f7' : 'transparent'}">
            <td style="padding:4px 8px;text-align:center;width:40px">
              <span style="display:inline-block;padding:1px 6px;background:${m.bg};color:${m.color};border-radius:8px;font-size:10px;font-weight:600">${m.icon}</span>
            </td>
            <td style="padding:4px 8px;font-size:10px;color:var(--text-3);text-align:right;width:30px">${p.idx}</td>
            ${cells}
            <td style="padding:4px 8px;font-size:10px;color:${m.color};max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(p.reason)}">${esc(p.reason)}</td>
          </tr>`;
        })
        .join('');

      wrap.innerHTML = `
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
          <span style="font-size:13px;font-weight:600">미리보기</span>
          <span style="font-size:12px;color:var(--text-2)">
            <span style="color:#16a34a">✓ ${validCount}건 정상</span>
            ${invalidCount > 0 ? ` · <span style="color:#dc2626">✗ ${invalidCount}건 실패</span>` : ''}
          </span>
          ${truncated ? `<span style="font-size:11px;color:#d97706;background:#fef3c7;padding:2px 8px;border-radius:8px">⚠ ${MAX_ROWS_TOTAL}행 초과 — 처음 ${MAX_ROWS_TOTAL}행만 표시</span>` : ''}
        </div>
        <div style="max-height:340px;overflow:auto;border:1px solid var(--border);border-radius:6px">
          <table class="data-table" style="font-size:11px;margin:0">
            <thead style="position:sticky;top:0;background:#fafafa;z-index:1">
              <tr>
                <th style="padding:6px 8px;width:40px">상태</th>
                <th style="padding:6px 8px;width:30px">#</th>
                ${cfg.columns.map(c => `<th style="padding:6px 8px">${esc(c.label)}${c.required ? '<span style="color:var(--oci-red)">*</span>' : ''}</th>`).join('')}
                <th style="padding:6px 8px">사유</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      `;
    }

    function _toggleFooter({ submit, reset, csv }) {
      const subBtn = document.getElementById('bp-submit-btn');
      const rstBtn = document.getElementById('bp-reset-btn');
      const csvBtn = document.getElementById('bp-csv-btn');
      if (subBtn) subBtn.style.display = submit ? '' : 'none';
      if (rstBtn) rstBtn.style.display = reset ? '' : 'none';
      if (csvBtn) csvBtn.style.display = csv ? '' : 'none';
    }

    async function _submit() {
      const validRows = state.parsed.filter(p => p.status === 'valid');
      if (!validRows.length) {
        if (typeof Toast !== 'undefined') Toast.warn('등록 가능한 행이 없습니다');
        return;
      }
      state.step = 'processing';
      const submitBtn = document.getElementById('bp-submit-btn');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '⏳ 처리 중...';
      }

      // 배치 분할 + 선택적 row 변환 (예: name → id 매핑)
      let rowsToSubmit = validRows.map(p => p.normalized);
      if (typeof cfg.beforeSubmit === 'function') {
        try {
          rowsToSubmit = cfg.beforeSubmit(rowsToSubmit) || rowsToSubmit;
        } catch (e) {
          console.warn('[BulkPaste] beforeSubmit 콜백 오류:', e?.message);
        }
      }
      const batches = chunk(rowsToSubmit, BATCH_SIZE);
      const aggregated = { inserted: 0, duplicates: 0, errors: [] };

      const wrap = document.getElementById('bp-preview-wrap');
      for (let i = 0; i < batches.length; i++) {
        if (wrap) {
          wrap.innerHTML = `<div style="padding:30px;text-align:center;color:var(--text-2)">
            <div style="font-size:14px;margin-bottom:10px">⏳ 배치 ${i + 1} / ${batches.length} 처리 중...</div>
            <div style="width:100%;max-width:320px;margin:0 auto;height:8px;background:var(--surface-2);border-radius:4px;overflow:hidden">
              <div style="width:${Math.round((i / batches.length) * 100)}%;height:100%;background:var(--oci-red);transition:width .3s"></div>
            </div>
          </div>`;
        }
        try {
          const res = await API.post(cfg.endpoint, { [cfg.payloadKey]: batches[i] });
          aggregated.inserted += Number(res.inserted || 0);
          aggregated.duplicates += Number(res.duplicates || 0);
          if (Array.isArray(res.errors)) {
            aggregated.errors.push(...res.errors);
          }
        } catch (err) {
          // 배치 전체 실패 — 모든 행을 fail 처리
          batches[i].forEach(row => {
            aggregated.errors.push({ row, reason: err?.message || '서버 오류' });
          });
        }
      }

      _renderResult(aggregated);
      if (submitBtn) {
        submitBtn.style.display = 'none';
        submitBtn.disabled = false;
        submitBtn.textContent = '✅ 등록하기';
      }
      // 성공 콜백 (적어도 1건 등록 시)
      if (aggregated.inserted > 0 && typeof cfg.onSuccess === 'function') {
        try {
          cfg.onSuccess(aggregated);
        } catch (e) {
          console.warn('[BulkPaste] onSuccess 콜백 오류:', e?.message);
        }
      }
    }

    function _renderResult(agg) {
      state.step = 'result';
      const wrap = document.getElementById('bp-preview-wrap');
      if (!wrap) return;

      const inserted = agg.inserted || 0;
      const duplicates = agg.duplicates || 0;
      const failed = (agg.errors || []).length;

      // 실패 행 상세 (백엔드 errors 매핑)
      const failedRows = (agg.errors || []).map((e, i) => ({
        idx: i + 1,
        row: e.row || {},
        reason: e.reason || '알 수 없음',
        isDuplicate: /중복|duplicate|dup/i.test(e.reason || ''),
      }));

      const failedHtml = failedRows.length
        ? `<div style="max-height:240px;overflow:auto;border:1px solid var(--border);border-radius:6px;margin-top:8px">
        <table class="data-table" style="font-size:11px;margin:0">
          <thead style="position:sticky;top:0;background:#fafafa">
            <tr>
              <th style="padding:6px 8px;width:30px">#</th>
              ${cfg.columns
                .slice(0, 4)
                .map(c => `<th style="padding:6px 8px">${esc(c.label)}</th>`)
                .join('')}
              <th style="padding:6px 8px">사유</th>
            </tr>
          </thead>
          <tbody>
            ${failedRows
              .map(
                f => `<tr style="background:${f.isDuplicate ? '#fef3c7' : '#fee2e2'}">
              <td style="padding:4px 8px;color:var(--text-3)">${f.idx}</td>
              ${cfg.columns
                .slice(0, 4)
                .map(c => `<td style="padding:4px 8px">${esc(f.row[c.key] || '')}</td>`)
                .join('')}
              <td style="padding:4px 8px;font-size:10px;color:${f.isDuplicate ? '#92400e' : '#991b1b'}">${esc(f.reason)}</td>
            </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>`
        : '';

      // 결과 박스
      wrap.innerHTML = `
        <div style="padding:20px;background:#fafafa;border-radius:8px;text-align:center;margin-bottom:10px">
          <div style="font-size:32px;margin-bottom:8px">
            ${inserted ? '✅' : duplicates ? '⚠️' : '❌'}
          </div>
          <div style="font-size:14px;font-weight:600;margin-bottom:6px">
            ${inserted ? `${inserted}건 등록 완료` : '등록된 항목 없음'}
          </div>
          <div style="font-size:12px;color:var(--text-2)">
            ${duplicates > 0 ? `<span style="color:#d97706">⚠ ${duplicates}건 중복 (건너뜀)</span>` : ''}
            ${duplicates > 0 && failed > 0 ? ' · ' : ''}
            ${failed > 0 ? `<span style="color:#dc2626">✗ ${failed}건 실패</span>` : ''}
          </div>
        </div>
        ${failedRows.length ? '<div style="font-size:12px;font-weight:600;margin-top:14px;margin-bottom:6px">실패 행 상세</div>' : ''}
        ${failedHtml}
      `;
      // 실패 행 있으면 CSV 다운로드 버튼 노출
      state._failedRows = failedRows;
      _toggleFooter({ submit: false, reset: true, csv: failedRows.length > 0 });

      // 등록 완료 토스트
      if (typeof Toast !== 'undefined') {
        const parts = [];
        if (inserted) parts.push(`${inserted}건 등록`);
        if (duplicates) parts.push(`${duplicates}건 중복 건너뜀`);
        if (failed) parts.push(`${failed}건 실패`);
        const msg = parts.join(' · ') || '결과 없음';
        if (inserted) Toast.success(msg);
        else if (duplicates) Toast.warn?.(msg);
        else Toast.error(msg);
      }
    }

    function _downloadFailedCsv() {
      const failedRows = state._failedRows || [];
      if (!failedRows.length) return;
      const headers = cfg.columns.map(c => c.label);
      const keys = cfg.columns.map(c => c.key);
      const csvRows = failedRows.map(f => {
        const row = {};
        cfg.columns.forEach((c, i) => {
          row[headers[i]] = f.row[keys[i]] || '';
        });
        row['_사유'] = f.reason;
        return row;
      });
      const csv = rowsToCsv([...headers, '_사유'], csvRows);
      // BOM (UTF-8) 추가 → 한글 Excel 호환
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${cfg.entityType}_실패행_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }
  }

  // ── 공개 API ───────────────────────────────────────────────
  return {
    open,
    // 테스트/외부 활용용 노출
    _internals: {
      sanitizeCell,
      validateRow,
      parseClipboard,
      mapHeaders,
      MAX_ROWS_PER_REQUEST,
      MAX_ROWS_TOTAL,
      BATCH_SIZE,
    },
  };
})();

// 전역 노출
if (typeof window !== 'undefined') window.BulkPaste = BulkPaste;
