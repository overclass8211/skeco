// =============================================================
// EmptyState — 통일된 빈 상태 UI 컴포넌트
//
// 사용법:
//   element.innerHTML = EmptyState.render({
//     icon:    '🎯',
//     title:   '아직 영업 리드가 없어요',
//     message: '첫 영업 기회를 추가해서 파이프라인을 시작하세요.',
//     primary: {
//       label:    '+ 첫 리드 추가',
//       dataAttr: 'data-action="open-lead-form"',
//     },
//     secondary: {  // 선택
//       label:  '엑셀 일괄 등록',
//       dataAttr: 'data-action="import-leads"',
//     },
//     hint: 'N 키로도 빠르게 추가 가능',  // 선택
//   });
//
// 사전 정의된 상태:
//   EmptyState.preset('leads')        — 영업 리드
//   EmptyState.preset('customers')    — 고객사
//   EmptyState.preset('projects')     — 프로젝트
//   EmptyState.preset('activities')   — 활동
//   EmptyState.preset('meetings')     — 회의록
//   EmptyState.preset('calendar')     — 캘린더
//   EmptyState.preset('board')        — 게시판
//   EmptyState.preset('dashboard')    — 대시보드
//   EmptyState.preset('search')       — 검색 결과 없음
//   EmptyState.preset('filter')       — 필터 결과 없음
// =============================================================
'use strict';

const EmptyState = {
  // ─── 사전 정의 상태 ─────────────────────────────────────
  PRESETS: {
    leads: {
      icon: '🎯',
      title: '아직 영업 리드가 없어요',
      message:
        '첫 영업 기회를 추가해서 파이프라인을 시작하세요. 단축키 <kbd>N</kbd> 으로도 빠르게 추가할 수 있어요.',
      primary: { label: '+ 첫 리드 추가', id: 'empty-leads-new' },
    },
    customers: {
      icon: '🏢',
      title: '등록된 고객사가 없어요',
      message:
        '고객사를 추가하면 영업 활동의 기반이 됩니다. 명함을 스캔하면 AI 가 자동으로 정보를 추출해요.',
      primary: { label: '+ 고객사 추가', id: 'empty-customers-new' },
    },
    projects: {
      icon: '🏗️',
      title: '진행 중인 프로젝트가 없어요',
      message: '수주된 리드를 프로젝트로 전환하거나 직접 등록해서 진행 상황을 관리하세요.',
      primary: { label: '+ 프로젝트 추가', id: 'empty-projects-new' },
    },
    activities: {
      icon: '⚡',
      title: '활동 이력이 없어요',
      message: '미팅 · 통화 · 제안서 등 영업 활동을 기록하면 리드별로 자동 추적됩니다.',
      primary: { label: '+ 활동 기록', id: 'empty-activities-new' },
    },
    meetings: {
      icon: '🎙️',
      title: 'AI 회의록이 없어요',
      message: '미팅을 녹음하면 AI 가 자동으로 요약 · 액션 아이템 · 영업 인사이트를 추출해줍니다.',
      primary: { label: '+ 새 회의록', id: 'empty-meetings-new' },
    },
    calendar: {
      icon: '📅',
      title: '등록된 일정이 없어요',
      message: '영업 미팅 · 입찰 마감 · 제안서 발송 등을 등록하면 자동 알림을 받을 수 있어요.',
      primary: { label: '+ 일정 추가', id: 'empty-calendar-new' },
    },
    board: {
      icon: '📢',
      title: '공지사항이 없어요',
      message: '팀에 공유할 내용을 첫 공지로 작성해 보세요.',
      primary: { label: '+ 공지 작성', id: 'empty-board-new' },
    },
    dashboard: {
      icon: '📊',
      title: '표시할 데이터가 없어요',
      message: '영업 리드를 추가하면 대시보드 차트와 지표가 채워집니다.',
      primary: { label: '+ 첫 리드 추가', id: 'empty-dashboard-new' },
    },
    search: {
      icon: '🔍',
      title: '검색 결과가 없어요',
      message: '다른 검색어를 시도하거나 필터를 변경해 보세요.',
      primary: null,
    },
    filter: {
      icon: '🤷',
      title: '조건에 맞는 데이터가 없어요',
      message: '필터를 해제하거나 다른 조합을 시도해 보세요.',
      primary: null,
    },
  },

  // ─── render — 표준 HTML 반환 (innerHTML 에 삽입) ────────
  render(opts = {}) {
    const o = { ...opts };
    const icon = o.icon || '✨';
    const title = o.title || '';
    const message = o.message || '';
    const primary = o.primary;
    const secondary = o.secondary;
    const hint = o.hint;

    // 액션 버튼 dataAttr 우선, 없으면 id, 없으면 둘 다 X
    const actionAttr = a => {
      if (!a) return '';
      if (a.dataAttr) return a.dataAttr;
      if (a.id) return `id="${this._esc(a.id)}"`;
      return '';
    };

    return `
      <div class="empty-state">
        <div class="empty-state-icon">${this._esc(icon)}</div>
        <div class="empty-state-title">${this._esc(title)}</div>
        ${message ? `<div class="empty-state-message">${message}</div>` : ''}
        ${
          primary || secondary
            ? `
          <div class="empty-state-actions">
            ${
              primary
                ? `
              <button class="btn btn-primary" ${actionAttr(primary)}>
                ${this._esc(primary.label)}
              </button>
            `
                : ''
            }
            ${
              secondary
                ? `
              <button class="btn btn-ghost" ${actionAttr(secondary)}>
                ${this._esc(secondary.label)}
              </button>
            `
                : ''
            }
          </div>
        `
            : ''
        }
        ${hint ? `<div class="empty-state-hint">${this._esc(hint)}</div>` : ''}
      </div>
    `;
  },

  // ─── preset — 사전 정의 + 오버라이드 ──────────────────────
  preset(key, override = {}) {
    const base = this.PRESETS[key] || {};
    return this.render({ ...base, ...override });
  },

  // ─── 유틸 ──────────────────────────────────────────────
  _esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },
};
