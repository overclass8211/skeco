// =============================================================
// contract-share.js — 외부 공유 페이지 (인증 우회 + 토큰 기반)
//
// URL: /contract-share.html?token=XXXXX[&as=email@example.com]
// - token: 공유 링크 토큰 (필수)
// - as: 본인 이메일 (선택 — viewed_at 기록용)
//
// 권한별 동작:
//   viewer: 계약 정보 + 파일 read-only
//   commenter: + 댓글 작성 가능
//   approver: + 승인/거부 추천 가능
// =============================================================
(function () {
  'use strict';

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function fmtKRW(n) {
    const v = Number(n);
    if (!v) return '-';
    return v.toLocaleString('ko-KR');
  }
  function fmtDate(s) {
    if (!s) return '-';
    const d = new Date(s);
    if (isNaN(d)) return s;
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
  }
  function fmtDateTime(s) {
    if (!s) return '';
    const d = new Date(s);
    if (isNaN(d)) return s;
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  const STATUS_LABELS = { draft: '초안', review: '검토', approved: '승인', completed: '완료' };
  const TYPE_LABELS = {
    NDA: 'NDA',
    MSA: 'MSA',
    SLA: 'SLA',
    SOW: 'SOW',
    service: '용역',
    purchase: '구매',
    license: '라이선스',
    employment: '고용',
    etc: '기타',
  };
  const COMMENT_TYPE_LABELS = {
    general: '의견',
    revise: '수정 요청',
    approve: '승인 추천',
    reject: '거부 추천',
  };

  // ── URL 파싱 ───────────────────────────────────────────
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token') || '';
  const asEmail = params.get('as') || '';

  function showToast(msg, isError) {
    const t = document.createElement('div');
    t.className = 'cs-toast' + (isError ? ' error' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }

  function showError(msg) {
    document.getElementById('cs-root').innerHTML = `<div class="cs-error">${esc(msg)}</div>`;
  }

  async function loadShareData() {
    if (!token) {
      showError('유효하지 않은 접근입니다 (토큰 누락)');
      return;
    }
    try {
      const qs = asEmail ? '?as=' + encodeURIComponent(asEmail) : '';
      const res = await fetch(`/api/contracts/share/${encodeURIComponent(token)}${qs}`);
      const json = await res.json();
      if (!json.success) {
        showError(json.error || '데이터를 불러오지 못했습니다');
        return;
      }
      render(json.data);
      await loadComments();
    } catch (err) {
      showError('네트워크 오류: ' + (err.message || err));
    }
  }

  async function loadComments() {
    try {
      const res = await fetch(`/api/contracts/share/${encodeURIComponent(token)}/comments`);
      const json = await res.json();
      if (!json.success) return;
      renderComments(json.data || []);
    } catch (_) {
      /* skip */
    }
  }

  function render(data) {
    const { contract, share, files, latest_legal_review } = data;
    const role = share?.role || 'viewer';

    // 역할 배지
    document.getElementById('cs-role-badge').innerHTML =
      `<span class="cs-role-badge cs-role-${esc(role)}">${esc(role.toUpperCase())}</span>`;

    // 검토 기한 D-N
    let dDay = '';
    if (contract.review_deadline) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const due = new Date(contract.review_deadline);
      due.setHours(0, 0, 0, 0);
      const days = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      const dColor = days < 0 ? '#dc2626' : days <= 7 ? '#f59e0b' : '#16a34a';
      dDay = `<span style="display:inline-block;margin-left:8px;padding:2px 10px;background:${dColor};color:#fff;border-radius:10px;font-size:11px;font-weight:600">${days < 0 ? `⛔ ${-days}일 경과` : `🔥 D-${days} 검토 기한`}</span>`;
    }

    const main = document.getElementById('cs-root');
    main.innerHTML = `
      <!-- 계약 기본 정보 -->
      <div class="cs-card">
        <h2>📜 ${esc(contract.title || '-')} ${dDay}</h2>
        <div class="cs-kv-row"><span class="cs-kv-key">계약번호</span><span class="cs-kv-val" style="font-family:monospace">${esc(contract.contract_no || '-')}</span></div>
        <div class="cs-kv-row"><span class="cs-kv-key">유형</span><span class="cs-kv-val">${esc(TYPE_LABELS[contract.contract_type] || contract.contract_type || '-')}</span></div>
        <div class="cs-kv-row"><span class="cs-kv-key">상태</span><span class="cs-kv-val">${esc(STATUS_LABELS[contract.status] || contract.status || '-')}</span></div>
        <div class="cs-kv-row"><span class="cs-kv-key">고객사</span><span class="cs-kv-val">${esc(contract.customer_name || '-')}</span></div>
        <div class="cs-kv-row"><span class="cs-kv-key">기간</span><span class="cs-kv-val">${fmtDate(contract.start_date)} ~ ${fmtDate(contract.end_date)}</span></div>
        <div class="cs-kv-row"><span class="cs-kv-key">금액</span><span class="cs-kv-val">${contract.contract_amount ? fmtKRW(contract.contract_amount) + ' ' + (contract.currency || 'KRW') : '-'}</span></div>
        ${contract.review_deadline ? `<div class="cs-kv-row"><span class="cs-kv-key">검토 기한</span><span class="cs-kv-val">${fmtDate(contract.review_deadline)}</span></div>` : ''}
      </div>

      <!-- AI 법무 검토 요약 (있을 때만) -->
      ${latest_legal_review ? `
        <div class="cs-card">
          <h2>🤖 AI 법무 검토 요약</h2>
          <div style="display:flex;align-items:center;gap:14px;margin-bottom:10px">
            <div style="font-size:28px;font-weight:700;color:${latest_legal_review.risk_level === 'high' ? '#dc2626' : latest_legal_review.risk_level === 'medium' ? '#ca8a04' : '#16a34a'}">${latest_legal_review.review_score}/100</div>
            <div style="font-size:13px">위험도: <strong>${esc(latest_legal_review.risk_level || '-')}</strong></div>
          </div>
          ${latest_legal_review.overall_assessment ? `<div style="font-size:12px;color:#374151;white-space:pre-wrap;line-height:1.7;padding:10px;background:var(--surface-2);border-radius:6px">${esc(latest_legal_review.overall_assessment)}</div>` : ''}
        </div>
      ` : ''}

      <!-- 파일 (다운로드) -->
      <div class="cs-card">
        <h2>📎 계약서 파일 (${files.length}건)</h2>
        ${files.length === 0
          ? '<div style="color:var(--text-3);font-size:13px;padding:14px;text-align:center;background:var(--surface-2);border-radius:6px">첨부 파일이 없습니다</div>'
          : `<ul class="cs-files">${files.map(f => `
              <li class="cs-file">
                <div>
                  <span class="cs-file-name">${esc(f.original_filename)}</span>
                  <span class="cs-file-size">${f.file_size ? (f.file_size / 1024).toFixed(1) + ' KB' : ''}</span>
                </div>
                <a class="cs-btn cs-btn-primary" href="${esc(f.download_url)}" download>⬇ 다운로드</a>
              </li>`).join('')}</ul>`
        }
      </div>

      <!-- 댓글 영역 -->
      <div class="cs-card">
        <h2>💬 검토 의견 <span id="cs-comments-count" style="font-size:12px;color:var(--text-3);font-weight:400"></span></h2>
        <div id="cs-comments" class="cs-comments"></div>

        ${role === 'commenter' || role === 'approver' ? `
          <div class="cs-comment-form">
            <div class="cs-form-row">
              <input class="cs-input" id="cs-author-name" placeholder="이름${asEmail ? '' : ' (필수)'}" value="">
              <input class="cs-input" id="cs-author-email" type="email" placeholder="이메일${asEmail ? '' : ' (필수)'}" value="${esc(asEmail)}">
            </div>
            <div style="display:flex;gap:8px;align-items:flex-start">
              <select class="cs-comment-type-select" id="cs-comment-type">
                <option value="general">의견</option>
                <option value="revise">수정 요청</option>
                ${role === 'approver' ? '<option value="approve">승인 추천</option><option value="reject">거부 추천</option>' : ''}
              </select>
              <textarea class="cs-textarea" id="cs-comment-body" placeholder="검토 의견을 입력하세요..."></textarea>
            </div>
            <div style="margin-top:8px;text-align:right">
              <button class="cs-btn cs-btn-primary" id="cs-submit-comment">💬 댓글 등록</button>
            </div>
          </div>
        ` : `
          <div style="margin-top:14px;padding:10px;background:var(--surface-2);border-radius:6px;font-size:12px;color:var(--text-3);text-align:center">
            🔒 읽기 전용 — 댓글 작성 권한이 없습니다
          </div>
        `}
      </div>
    `;

    // 댓글 등록 이벤트
    const submitBtn = document.getElementById('cs-submit-comment');
    if (submitBtn) {
      submitBtn.addEventListener('click', submitComment);
    }
  }

  function renderComments(comments) {
    const wrap = document.getElementById('cs-comments');
    const countEl = document.getElementById('cs-comments-count');
    if (countEl) countEl.textContent = `(${comments.length}건)`;
    if (!wrap) return;
    if (comments.length === 0) {
      wrap.innerHTML =
        '<div style="color:var(--text-3);font-size:12px;padding:14px;text-align:center">아직 등록된 댓글이 없습니다</div>';
      return;
    }
    wrap.innerHTML = comments
      .map(c => {
        const authorName =
          c.author_name || c.internal_author_name || c.author_email || '익명';
        const typeLabel = COMMENT_TYPE_LABELS[c.comment_type] || c.comment_type;
        return `<div class="cs-comment">
          <div class="cs-comment-meta">
            <span><strong>${esc(authorName)}</strong>
              <span class="cs-comment-type cs-type-${esc(c.comment_type)}">${esc(typeLabel)}</span>
            </span>
            <span>${esc(fmtDateTime(c.created_at))}</span>
          </div>
          <div class="cs-comment-body">${esc(c.body)}</div>
        </div>`;
      })
      .join('');
  }

  async function submitComment() {
    const nameEl = document.getElementById('cs-author-name');
    const emailEl = document.getElementById('cs-author-email');
    const bodyEl = document.getElementById('cs-comment-body');
    const typeEl = document.getElementById('cs-comment-type');
    const name = (nameEl?.value || '').trim();
    const email = (emailEl?.value || '').trim();
    const body = (bodyEl?.value || '').trim();
    const commentType = typeEl?.value || 'general';
    if (!name || !email) {
      showToast('이름과 이메일을 입력하세요', true);
      return;
    }
    if (!body) {
      showToast('댓글 내용을 입력하세요', true);
      return;
    }
    const submitBtn = document.getElementById('cs-submit-comment');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ 등록 중...';
    }
    try {
      const res = await fetch(`/api/contracts/share/${encodeURIComponent(token)}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          author_name: name,
          author_email: email,
          body,
          comment_type: commentType,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        showToast(json.error || '댓글 등록 실패', true);
      } else {
        showToast('댓글이 등록되었습니다 — 관련 모든 사람에게 알림이 발송됩니다');
        if (bodyEl) bodyEl.value = '';
        await loadComments();
      }
    } catch (err) {
      showToast('등록 실패: ' + (err.message || err), true);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '💬 댓글 등록';
      }
    }
  }

  // 시작
  loadShareData();
})();
