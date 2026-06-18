// =============================================================
// readReceipts — 목록 항목의 읽음/안읽음 시각화 헬퍼
//
// 모듈별 목록 페이지에서 공통 사용:
//   1. ReadReceipts.renderTitleBadge(item)
//      → 제목 앞에 붙일 [NEW] 또는 [업데이트] 배지 HTML
//   2. ReadReceipts.rowStyleAttr(item)
//      → 행에 적용할 style 속성 (음영/opacity)
//   3. ReadReceipts.tooltipAttr(item)
//      → title 속성 ("마지막 열람: ...")
//
// 백엔드 enrich 결과 (item._read_status 또는 직접 필드):
//   - is_read: boolean
//   - has_update_after_read: boolean
//   - last_read_at: ISO datetime or null
// =============================================================
(function (root) {
  'use strict';

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // 상대 시간 ("3일 전", "방금")
  function timeAgo(iso) {
    if (!iso) return '';
    const t = new Date(iso).getTime();
    if (isNaN(t)) return '';
    const diff = Date.now() - t;
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return '방금 전';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}분 전`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}시간 전`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day}일 전`;
    const mon = Math.floor(day / 30);
    if (mon < 12) return `${mon}개월 전`;
    return `${Math.floor(mon / 12)}년 전`;
  }

  function fmtDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  /**
   * 제목 앞에 붙일 NEW/업데이트 배지 HTML
   * - 안 읽음: 빨간 (NEW) 배지
   * - 본 이후 수정됨: 노란 (업데이트) 배지
   * - 읽음 (수정 없음): 빈 문자열
   */
  function renderTitleBadge(item) {
    if (!item) return '';
    if (item.is_read === false || item.is_read === undefined) {
      return `<span class="rr-badge rr-badge-new" style="display:inline-block;padding:1px 6px;margin-right:6px;background:#dc2626;color:#fff;border-radius:8px;font-size:9px;font-weight:700;vertical-align:middle">NEW</span>`;
    }
    if (item.has_update_after_read === true) {
      return `<span class="rr-badge rr-badge-update" style="display:inline-block;padding:1px 6px;margin-right:6px;background:#d97706;color:#fff;border-radius:8px;font-size:9px;font-weight:700;vertical-align:middle">업데이트</span>`;
    }
    return '';
  }

  /**
   * 행에 적용할 style 속성
   * - 읽음 (수정 없음): 회색 배경 + opacity 0.85 (음영)
   * - 안 읽음/업데이트: 그대로
   */
  function rowStyleAttr(item) {
    if (!item) return '';
    if (item.is_read === true && item.has_update_after_read !== true) {
      return 'background:#fafafa;opacity:0.78';
    }
    return '';
  }

  /**
   * 행 className 추가 (읽음 vs 안읽음 구분)
   */
  function rowClass(item) {
    if (!item) return '';
    if (item.is_read === true && item.has_update_after_read !== true) return 'rr-read';
    if (item.has_update_after_read === true) return 'rr-updated';
    return 'rr-unread';
  }

  /**
   * title (tooltip) 속성 — 행 hover 시 표시
   */
  function tooltipAttr(item) {
    if (!item) return '';
    if (item.is_read === false || item.is_read === undefined) {
      return ' title="아직 열람하지 않음"';
    }
    if (item.has_update_after_read === true) {
      return ` title="열람: ${esc(timeAgo(item.last_read_at))} · 이후 다른 사람이 수정"`;
    }
    return ` title="마지막 열람: ${esc(timeAgo(item.last_read_at))} (${esc(fmtDateTime(item.last_read_at))})"`;
  }

  /**
   * 안 읽음 카운트 — 목록 배열에서 즉시 계산
   */
  function countUnread(items) {
    if (!Array.isArray(items)) return 0;
    return items.filter(it => it && it.is_read !== true).length;
  }

  /**
   * 안 읽은 항목만 필터
   */
  function filterUnread(items) {
    if (!Array.isArray(items)) return [];
    return items.filter(it => it && (it.is_read !== true || it.has_update_after_read === true));
  }

  /**
   * 항목 클릭 시 즉시 클라이언트 측 read 표시 갱신 (UI 즉시 반응 — 백엔드 호출은 GET /:id 에서 자동)
   */
  function markAsReadLocal(item) {
    if (!item) return;
    item.is_read = true;
    item.has_update_after_read = false;
    item.last_read_at = new Date().toISOString();
  }

  /**
   * "모두 읽음" — 백엔드 일괄 호출 + 로컬 상태 갱신
   */
  async function markAllRead(entityType, items) {
    if (!Array.isArray(items) || items.length === 0) return { count: 0 };
    const ids = items
      .filter(it => it && it.id && it.is_read !== true)
      .map(it => it.id);
    if (ids.length === 0) return { count: 0 };
    try {
      await window.API.post('/read-receipts/mark-many', {
        entity_type: entityType,
        entity_ids: ids,
      });
      items.forEach(it => {
        if (ids.includes(it.id)) markAsReadLocal(it);
      });
      return { count: ids.length };
    } catch (e) {
      console.warn('[ReadReceipts] markAllRead 실패:', e?.message);
      return { count: 0, error: e?.message };
    }
  }

  // 전역 expose
  root.ReadReceipts = {
    renderTitleBadge,
    rowStyleAttr,
    rowClass,
    tooltipAttr,
    countUnread,
    filterUnread,
    markAsReadLocal,
    markAllRead,
    timeAgo,
    fmtDateTime,
  };
})(window);
