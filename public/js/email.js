// =============================================================
// Email — 이메일 발송 모달 + Mailto 링크 + 활동 자동기록
//
// 어디서나 호출 가능한 단일 진입점:
//   Email.open({ context })
//
// context 형식:
//   {
//     to:         'user@example.com'      // 수신자 (옵션, 없으면 사용자 입력)
//     customer:   { id, name, email, contact_person },  // 변수 치환용
//     lead:       { id, project_name, customer_name, bidding_deadline },
//     project:    { id, name, customer_name },
//     defaultCategory: 'lead' | 'customer' | 'project' | 'general'
//   }
// =============================================================
'use strict';

const Email = {
  templates: null, // 캐시 (Email.open 시 1회 로드)
  loading: false,

  // ─── 진입점 ─────────────────────────────────────────────
  async open(context = {}) {
    await this._ensureTemplates();
    const tpls = this._filterByCategory(this.templates, context.defaultCategory);
    if (!tpls.length) {
      Toast?.show?.('사용 가능한 템플릿이 없습니다.', 'warn');
      return;
    }

    // 첫 템플릿 자동 선택
    const initial = tpls[0];
    const ctx = this._buildContext(context);

    Modal.open({
      title: '✉️ 이메일 보내기',
      body: this._buildBody(tpls, initial.id, ctx, initial),
      footer: `
        <button class="btn btn-secondary" id="email-cancel-btn">취소</button>
        <button class="btn btn-ghost" id="email-send-btn" title="OS 기본 메일 앱(Outlook/Mail 등) 열기">📤 메일 클라이언트 열기</button>
        <button class="btn btn-primary" id="email-gmail-send-btn" title="Gmail API 로 직접 발송">📧 Gmail 로 발송</button>
      `,
      bind: {
        '#email-cancel-btn': () => Modal.close(),
        '#email-send-btn': () => this._send(ctx),
        '#email-gmail-send-btn': () => this._sendViaGmail(ctx),
      },
    });

    // 템플릿 변경 핸들러
    setTimeout(() => this._bindModalEvents(tpls, ctx), 50);
  },

  // ─── 템플릿 캐시 로드 ────────────────────────────────────
  async _ensureTemplates(force = false) {
    if (this.templates && !force) return;
    if (this.loading) return;
    this.loading = true;
    try {
      const r = await API.get('/email-templates');
      this.templates = r.data || [];
    } catch (e) {
      Toast?.show?.('템플릿 로드 실패: ' + (e.message || ''), 'error');
      this.templates = [];
    } finally {
      this.loading = false;
    }
  },

  _filterByCategory(all, category) {
    // 카테고리는 정렬 우선순위로만 사용 — 모든 템플릿을 표시하되
    // 컨텍스트와 일치하는 것을 먼저 보여줘 사용자가 적합한 것을 선택하도록.
    if (!category) return all;
    const matched = all.filter(t => t.category === category);
    const others = all.filter(t => t.category !== category);
    return [...matched, ...others];
  },

  // ─── 변수 컨텍스트 구성 ─────────────────────────────────
  _buildContext(ctx) {
    const user = (() => {
      try {
        return JSON.parse(localStorage.getItem('oci_user') || '{}');
      } catch {
        return {};
      }
    })();
    const today = new Date().toISOString().slice(0, 10);

    // 변수 사전 — 우선순위: 명시적 context > 로그인 사용자 > 빈 문자열
    const vars = {
      customer_name:
        ctx.customer?.name || ctx.lead?.customer_name || ctx.project?.customer_name || '',
      contact_person: ctx.customer?.contact_person || '',
      project_name: ctx.lead?.project_name || ctx.project?.name || '',
      my_name: user.full_name || user.username || '',
      my_company: 'OCI', // TODO: system_settings.company_name 연동 가능
      today,
      bidding_deadline: ctx.lead?.bidding_deadline
        ? String(ctx.lead.bidding_deadline).slice(0, 10)
        : '',
    };

    // 수신자
    const to = ctx.to || ctx.customer?.email || '';

    // 연결할 활동 부모 (자동 기록용)
    const activityParent = {
      lead_id: ctx.lead?.id || null,
      project_id: ctx.project?.id || null,
    };

    return { vars, to, activityParent };
  },

  // ─── 변수 치환 (XSS-safe — 결과는 textarea 에만 들어감) ───
  _interpolate(template, vars) {
    if (!template) return '';
    return String(template).replace(/\{\{(\w+)\}\}/g, (_, key) => {
      return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : `{{${key}}}`;
    });
  },

  // ─── 모달 body ──────────────────────────────────────────
  _buildBody(tpls, selectedId, ctx, tpl) {
    const subject = this._interpolate(tpl.subject, ctx.vars);
    const body = this._interpolate(tpl.body, ctx.vars);

    const tplOptions = tpls
      .map(
        t => `
      <option value="${t.id}" ${t.id === selectedId ? 'selected' : ''}>
        ${this._esc(t.name)} ${t.is_system ? '🔒' : ''}
      </option>
    `
      )
      .join('');

    return `
      <div class="email-modal-wrap">
        <div class="form-grid" style="grid-template-columns: 120px 1fr; gap: 10px 12px; align-items: center">
          <label class="form-label">템플릿</label>
          <select class="form-control" id="email-tpl-select">${tplOptions}</select>

          <label class="form-label">받는 사람</label>
          <input type="email" class="form-control" id="email-to" value="${this._esc(ctx.to)}"
                 placeholder="recipient@example.com">

          <label class="form-label">제목</label>
          <input type="text" class="form-control" id="email-subject" value="${this._esc(subject)}"
                 maxlength="300">

          <label class="form-label" style="align-self:flex-start;padding-top:6px">본문</label>
          <textarea class="form-control" id="email-body" rows="12"
                    style="font-family:inherit;line-height:1.6">${this._esc(body)}</textarea>
        </div>

        <div class="email-modal-options" style="margin-top:12px;display:flex;align-items:center;gap:8px">
          <label class="email-checkbox" style="display:flex;align-items:center;gap:6px;font-size:13px">
            <input type="checkbox" id="email-log-activity" checked>
            <span>활동 이력에 자동 기록</span>
          </label>
        </div>

        <div class="email-modal-help" style="margin-top:10px;font-size:11px;color:var(--text-3);line-height:1.6">
          💡 [메일 클라이언트 열기] 클릭 시 OS 기본 메일 앱(Outlook / Gmail / Mail 등)이 열립니다.<br>
          ⚠️ Mailto 표준 제약으로 첨부 파일은 지원되지 않습니다. 본문에 별도 안내 추가를 권장합니다.
        </div>
      </div>
    `;
  },

  _bindModalEvents(tpls, ctx) {
    document.getElementById('email-tpl-select')?.addEventListener('change', e => {
      const id = parseInt(e.target.value, 10);
      const tpl = tpls.find(t => t.id === id);
      if (!tpl) return;
      const subj = document.getElementById('email-subject');
      const body = document.getElementById('email-body');
      if (subj) subj.value = this._interpolate(tpl.subject, ctx.vars);
      if (body) body.value = this._interpolate(tpl.body, ctx.vars);
    });
  },

  // ─── 발송 — Mailto URL 조립 + 활동 기록 ─────────────────
  async _send(ctx) {
    const to = document.getElementById('email-to')?.value?.trim() || '';
    const subject = document.getElementById('email-subject')?.value || '';
    const body = document.getElementById('email-body')?.value || '';
    const logAct = document.getElementById('email-log-activity')?.checked;

    if (!to) {
      Toast?.show?.('받는 사람 이메일을 입력하세요.', 'warn');
      return;
    }
    if (!subject.trim()) {
      Toast?.show?.('제목을 입력하세요.', 'warn');
      return;
    }

    // Mailto URL — encodeURIComponent 로 안전하게 인코딩
    const url =
      `mailto:${encodeURIComponent(to)}` +
      `?subject=${encodeURIComponent(subject)}` +
      `&body=${encodeURIComponent(body)}`;

    // 메일 클라이언트 열기 (사용자 액션이라 팝업 차단 없음)
    // — 테스트 환경에서 가로챌 수 있도록 별도 메서드로 분리
    this._openMailto(url);

    // 활동 자동 기록 (옵션)
    if (logAct && (ctx.activityParent.lead_id || ctx.activityParent.project_id)) {
      try {
        await API.post('/activities', {
          lead_id: ctx.activityParent.lead_id,
          project_id: ctx.activityParent.project_id,
          activity_type: '이메일',
          title: (subject || '이메일 발송').slice(0, 290),
          content: `수신자: ${to}\n\n${body}`.slice(0, 5000),
        });
        Toast?.show?.('메일 클라이언트가 열렸고 활동 이력에 기록되었습니다.', 'success');
      } catch (e) {
        Toast?.show?.('메일 클라이언트는 열렸으나 활동 기록 실패: ' + (e.message || ''), 'warn');
      }
    } else {
      Toast?.show?.('메일 클라이언트를 열었습니다.', 'success');
    }

    Modal.close();
  },

  // ─── Mailto 열기 — 테스트 hook 가능 ─────────────────────
  // window.__e2eOpenMailto 가 있으면 그것을 호출 (E2E 테스트용)
  // 일반 환경에서는 window.location.href 에 mailto: 설정 → OS 메일 앱 실행
  _openMailto(url) {
    if (typeof window !== 'undefined' && typeof window.__e2eOpenMailto === 'function') {
      window.__e2eOpenMailto(url);
      return;
    }
    window.location.href = url;
  },

  // ─── Gmail API 로 직접 발송 (Phase G2) ──────────────────
  async _sendViaGmail(ctx) {
    const to = document.getElementById('email-to')?.value?.trim() || '';
    const subject = document.getElementById('email-subject')?.value || '';
    const body = document.getElementById('email-body')?.value || '';
    const logAct = document.getElementById('email-log-activity')?.checked;

    if (!to) {
      Toast?.show?.('받는 사람 이메일을 입력하세요.', 'warn');
      return;
    }
    if (!subject.trim()) {
      Toast?.show?.('제목을 입력하세요.', 'warn');
      return;
    }

    // 발송 중 버튼 비활성화
    const btn = document.getElementById('email-gmail-send-btn');
    const origLabel = btn?.textContent;
    if (btn) {
      btn.disabled = true;
      btn.textContent = '📧 발송 중...';
    }

    try {
      const r = await API.gmail.send({ to, subject, body });
      // 성공
      Toast?.show?.(`📧 Gmail 발송 완료 (${r.data?.from || ''})`, 'success');

      // 활동 자동 기록 (옵션) — 기존 _send 와 동일 패턴
      if (logAct && (ctx.activityParent.lead_id || ctx.activityParent.project_id)) {
        try {
          await API.post('/activities', {
            lead_id: ctx.activityParent.lead_id,
            project_id: ctx.activityParent.project_id,
            activity_type: '이메일',
            title: (subject || '이메일 발송').slice(0, 290),
            content: `[Gmail 발송] 수신자: ${to}\n\n${body}`.slice(0, 5000),
          });
        } catch (e) {
          Toast?.show?.('Gmail 발송은 성공했으나 활동 기록 실패: ' + (e.message || ''), 'warn');
        }
      }

      Modal.close();
    } catch (err) {
      // API helper 가 throw — err.message 또는 응답 본문
      // notConnected / scopeRequired 친절 안내
      const msg = err?.body?.error || err?.message || '';
      const scopeRequired = err?.body?.scopeRequired;
      const notConnected = err?.body?.notConnected;
      if (scopeRequired === 'gmail.readonly' || /권한이 없/i.test(msg)) {
        Toast?.show?.('⚠️ Gmail 권한 없음 — Google 계정 재연결 필요 (설정 메뉴)', 'error');
      } else if (notConnected || /연결되지|만료/i.test(msg)) {
        Toast?.show?.('🔌 Google 미연결 — 설정에서 Google 계정 연결 후 다시 시도', 'error');
      } else {
        Toast?.show?.('Gmail 발송 실패: ' + msg, 'error');
      }
      if (btn) {
        btn.disabled = false;
        btn.textContent = origLabel || '📧 Gmail 로 발송';
      }
    }
  },

  // ─── HTML 이스케이프 ────────────────────────────────────
  _esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },
};
