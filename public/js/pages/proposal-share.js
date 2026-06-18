'use strict';
/*
 * 제안 외부 공유 페이지 클라이언트 (Phase 5-E)
 *
 * URL: /proposal-share.html?t=<token>
 * 백엔드: GET /api/proposals/share/:token  (인증 우회)
 *
 * 상태별 렌더:
 *   - 200 → 정상 데이터 표시
 *   - 404 → "유효하지 않은 링크"
 *   - 410 → "만료된 링크"
 *   - 그 외 → "서버 오류"
 *
 * 보안:
 *   - 토큰은 URL 에서만 (localStorage 저장 X)
 *   - 인증/세션 사용 안 함 (외부 접근)
 *   - Service Worker 자체 등록 안 함 (캐싱 회피)
 */

(function () {
  const ROOT = document.getElementById('ps-root');
  const HEADER_RIGHT = document.getElementById('ps-shared-until-header');

  // HTML 이스케이프 (XSS 안전)
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // 날짜/시각 포맷 (YYYY.MM.DD HH:mm)
  function fmtDateTime(s) {
    if (!s) return '';
    const d = new Date(s);
    if (isNaN(d)) return s;
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // 날짜만 (YYYY.MM.DD)
  function fmtDate(s) {
    if (!s) return '';
    const d = new Date(s);
    if (isNaN(d)) return s;
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
  }

  // KB / MB 단위로 사이즈 표시
  function fmtSize(bytes) {
    if (!bytes || bytes <= 0) return '-';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  }

  // 파일 유형 → 아이콘
  function fileIcon(filename) {
    const ext = String(filename || '')
      .toLowerCase()
      .match(/\.([^.]+)$/);
    const e = ext ? ext[1] : '';
    if (e === 'pdf') return '📄';
    if (['ppt', 'pptx'].includes(e)) return '📊';
    if (['doc', 'docx', 'hwp', 'hwpx'].includes(e)) return '📝';
    if (['xls', 'xlsx'].includes(e)) return '📈';
    if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(e)) return '🖼️';
    return '📎';
  }

  // 파일 유형 라벨
  function fileTypeLabel(t) {
    const m = {
      rfp: 'RFP',
      proposal: '제안서',
      quote: '견적',
      company_profile: '회사소개',
      reference: '레퍼런스',
      response_form: '응답서',
      etc: '기타',
    };
    return m[t] || t || '-';
  }

  // 에러 페이지 렌더
  function renderError(opts) {
    ROOT.innerHTML = `
      <div class="ps-error">
        <div class="ps-error-icon">${esc(opts.icon || '⚠️')}</div>
        <h1>${esc(opts.title || '오류')}</h1>
        <p>${esc(opts.message || '')}</p>
        ${opts.detail ? `<p style="font-size:11px;color:#86909C;margin-top:14px">${esc(opts.detail)}</p>` : ''}
      </div>
    `;
  }

  // 정상 데이터 렌더
  function renderProposal(data) {
    const files = Array.isArray(data.files) ? data.files : [];
    const filesHtml = files.length
      ? `<div class="ps-files">
          ${files
            .map(
              f => `<div class="ps-file">
            <div class="ps-file-icon">${fileIcon(f.original_filename)}</div>
            <div class="ps-file-info">
              <div class="ps-file-name">${esc(f.original_filename)}</div>
              <div class="ps-file-meta">${esc(fileTypeLabel(f.file_type))} · v${f.revision_no || 1} · ${esc(fmtSize(f.file_size))}</div>
            </div>
            <a class="ps-file-download" href="${esc(f.download_url)}" download="${esc(f.original_filename)}" rel="noopener">⬇️ 다운로드</a>
          </div>`
            )
            .join('')}
        </div>`
      : `<div class="ps-empty">공유 파일이 없습니다</div>`;

    const summaryHtml = data.rfp_summary
      ? `<div class="ps-summary">${esc(data.rfp_summary)}</div>`
      : `<div class="ps-empty">RFP 요약 정보가 없습니다</div>`;

    ROOT.innerHTML = `
      <div class="ps-card">
        <div class="ps-title-block">
          ${data.proposal_no ? `<div class="ps-no">${esc(data.proposal_no)}</div>` : ''}
          <h1 class="ps-title">${esc(data.proposal_title || '제안')}</h1>
        </div>

        <div class="ps-meta">
          <div class="ps-meta-row">
            <div class="ps-meta-label">🏢 고객사</div>
            <div class="ps-meta-value">${esc(data.customer_name || '-')}</div>
          </div>
          <div class="ps-meta-row">
            <div class="ps-meta-label">📅 작성일</div>
            <div class="ps-meta-value">${esc(fmtDate(data.proposal_date))}</div>
          </div>
          ${
            data.rfp_title
              ? `<div class="ps-meta-row" style="grid-column:1 / -1">
                  <div class="ps-meta-label">📑 RFP 제목</div>
                  <div class="ps-meta-value">${esc(data.rfp_title)}</div>
                </div>`
              : ''
          }
        </div>

        <div class="ps-section">
          <div class="ps-section-title">📝 RFP 요약</div>
          ${summaryHtml}
        </div>

        <div class="ps-section">
          <div class="ps-section-title">📎 공유 파일 (${files.length}건)</div>
          ${filesHtml}
        </div>
      </div>

      ${
        data.shared_until
          ? `<div class="ps-footer-expires-wrap" style="text-align:center;margin-bottom:12px">
              <div class="ps-footer-expires">⏳ 이 링크는 <strong>${esc(fmtDateTime(data.shared_until))}</strong> 까지 유효합니다</div>
            </div>`
          : ''
      }
    `;

    // 헤더 우측에도 만료 정보
    if (data.shared_until && HEADER_RIGHT) {
      HEADER_RIGHT.textContent = `만료: ${fmtDateTime(data.shared_until)}`;
    }
  }

  // URL 에서 토큰 파싱
  function parseToken() {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('t') || params.get('token') || '';
    return t.trim();
  }

  // 데이터 fetch + 상태별 분기
  async function load() {
    const token = parseToken();
    if (!token) {
      renderError({
        icon: '🔗',
        title: '잘못된 링크',
        message: '공유 링크에 토큰이 없습니다.',
        detail: 'URL 의 ?t= 파라미터가 누락되었습니다',
      });
      return;
    }
    // 토큰 길이 사전 검증 (서버 측 검증과 동일)
    if (token.length < 20 || token.length > 64) {
      renderError({
        icon: '🔗',
        title: '잘못된 링크',
        message: '토큰 형식이 올바르지 않습니다.',
      });
      return;
    }

    let res;
    try {
      res = await fetch(`/api/proposals/share/${encodeURIComponent(token)}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'omit', // 인증 정보 보내지 않음 (외부 접근)
      });
    } catch (_e) {
      renderError({
        icon: '🌐',
        title: '네트워크 오류',
        message: '서버에 연결할 수 없습니다.',
        detail: '잠시 후 다시 시도해 주세요',
      });
      return;
    }

    // 상태별 분기
    if (res.status === 404) {
      renderError({
        icon: '🔍',
        title: '유효하지 않은 링크',
        message: '이 공유 링크는 존재하지 않거나 무효화되었습니다.',
        detail: '발신자에게 새 링크를 요청해 주세요',
      });
      return;
    }
    if (res.status === 410) {
      renderError({
        icon: '⏰',
        title: '만료된 링크',
        message: '이 공유 링크는 유효 기간이 만료되었습니다.',
        detail: '발신자에게 재발급을 요청해 주세요',
      });
      return;
    }
    if (!res.ok) {
      renderError({
        icon: '⚠️',
        title: '서버 오류',
        message: `요청 중 오류가 발생했습니다 (HTTP ${res.status})`,
      });
      return;
    }

    let body;
    try {
      body = await res.json();
    } catch (_) {
      renderError({
        icon: '⚠️',
        title: '응답 오류',
        message: '서버 응답을 해석할 수 없습니다.',
      });
      return;
    }

    if (!body.success || !body.data) {
      renderError({
        icon: '⚠️',
        title: '데이터 없음',
        message: body.error || '응답에 데이터가 없습니다.',
      });
      return;
    }

    renderProposal(body.data);
  }

  // 페이지 진입 시 자동 로드
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
