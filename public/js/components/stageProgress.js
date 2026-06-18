'use strict';
// =============================================================
// StageProgress — 단계 진척률 바 공통 컴포넌트 (v6.0.0)
//
// 5개 모듈(리드/견적/제안/계약) 워크플로우 시각화 통일
// 고객사는 워크플로우 자체가 없어 미적용
//
// 사용 (각 모듈 stage map 정의 후 호출):
//   StageProgress.render({
//     stages: [
//       { key: 'draft',    label: '초안',  color: '#6b7280' },
//       { key: 'review',   label: '검토',  color: '#3b82f6' },
//       { key: 'approved', label: '승인',  color: '#16a34a' },
//       { key: 'completed',label: '완료',  color: '#0891b2' },
//     ],
//     current: 'approved',  // 현재 단계 key
//     size: 'sm' | 'md',    // default 'sm' (목록행용)
//     showLabels: false,    // 라벨 표시 여부 (default false)
//     terminal: null,       // 종료 key (lost/rejected 등) 표시 시
//   });
//
// 디자인 원칙:
//   - 원형 step (sm: 14px, md: 20px)
//   - done: ✓ + 컬러 fill (opacity 0.85)
//   - current: ● + 컬러 fill + ring + scale(1.15)
//   - pending: ○ + 회색
//   - terminal (lost/rejected/expired): 빨강/회색 single chip 으로 대체
//   - connector: 양 stage 간 2px 라인
// =============================================================
const StageProgress = (() => {
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * 단계 진척률 바 HTML 생성
   * @param {Object} opts
   * @param {Array<{key,label,color}>} opts.stages — 정상 흐름 단계 배열
   * @param {string} opts.current — 현재 단계 key
   * @param {'sm'|'md'} [opts.size='sm'] — 크기
   * @param {boolean} [opts.showLabels=false] — 단계명 표시
   * @param {Object} [opts.terminal] — 종료 단계 정의 {key, label, color}
   *   현재 상태가 terminal.key 와 매치되면 진척률 대신 종료 chip 표시
   * @returns {string} HTML
   */
  function render({ stages, current, size = 'sm', showLabels = false, terminal = null } = {}) {
    if (!Array.isArray(stages) || stages.length === 0) return '';

    // 종료 상태 (lost/rejected 등) — 진척률 표시 대신 단일 종료 chip
    if (terminal && current === terminal.key) {
      return `<div class="stage-progress stage-progress-${size} stage-terminal"
        style="--stage-color:${terminal.color}" title="${esc(terminal.label)}">
        <div class="stage-step current">
          <span aria-hidden="true">✕</span>
        </div>
        ${showLabels ? `<span class="stage-terminal-label">${esc(terminal.label)}</span>` : ''}
      </div>`;
    }

    const currentIdx = stages.findIndex(s => s.key === current);
    const safeIdx = currentIdx < 0 ? 0 : currentIdx;

    const parts = [];
    stages.forEach((stg, i) => {
      const isDone = i < safeIdx;
      const isCurrent = i === safeIdx;
      const stepCls = isCurrent ? 'current' : isDone ? 'done' : 'pending';
      const sym = isDone ? '✓' : isCurrent ? '●' : '○';
      parts.push(
        `<div class="stage-step ${stepCls}" style="--stage-color:${stg.color}"
          title="${esc(stg.label)}${isCurrent ? ' (현재)' : ''}">
          <span aria-hidden="true">${sym}</span>
        </div>`
      );
      // connector — 마지막 단계 뒤엔 없음
      if (i < stages.length - 1) {
        const connDone = i < safeIdx;
        const connColor = connDone ? stages[i + 1].color : '';
        parts.push(
          `<div class="stage-connector ${connDone ? 'done' : ''}"
            style="${connColor ? `--stage-color:${connColor}` : ''}"></div>`
        );
      }
    });

    const labelHtml = showLabels
      ? `<span class="stage-progress-label">${esc(stages[safeIdx].label)}</span>`
      : '';

    return `<div class="stage-progress stage-progress-${size}"
      role="progressbar"
      aria-valuemin="0" aria-valuemax="${stages.length}" aria-valuenow="${safeIdx + 1}"
      aria-label="단계: ${esc(stages[safeIdx].label)}">
      ${parts.join('')}
      ${labelHtml}
    </div>`;
  }

  return { render };
})();
