// ============================================================
// AI Assistant — OCI CRM
// Claude API 스트리밍 기반 AI 어시스턴트
// ============================================================
const AI = {
  isOpen: false,
  messages: [], // { role, content }
  currentStream: null, // AbortController

  // ── 인증 헤더 ─────────────────────────────────────────────
  _authHeaders(extra = {}) {
    const token = localStorage.getItem('oci_token') || sessionStorage.getItem('oci_token');
    const uid = localStorage.getItem('current_user_id');
    const h = { 'Content-Type': 'application/json', ...extra };
    if (token) h['Authorization'] = `Bearer ${token}`;
    if (uid) h['X-User-Id'] = uid;
    return h;
  },

  // ── 패널 열기/닫기 ──────────────────────────────────────
  toggle() {
    this.isOpen ? this.close() : this.open();
  },

  open() {
    this.isOpen = true;
    document.getElementById('ai-panel').classList.add('open');
    document.getElementById('ai-overlay').classList.add('show');
    document.getElementById('ai-input').focus();
    if (!this.messages.length) this.addWelcome();
  },

  close() {
    this.isOpen = false;
    document.getElementById('ai-panel').classList.remove('open');
    document.getElementById('ai-overlay').classList.remove('show');
  },

  addWelcome() {
    const ctx = App.currentPage;
    const welcomes = {
      dashboard: '대시보드 현황을 분석해드릴까요? 파이프라인 인사이트나 주요 리스크를 물어보세요.',
      leads:
        '영업 리드에 대해 궁금한 점을 물어보세요. 특정 고객사 현황, 단계별 현황 등을 안내해드립니다.',
      pipeline: '파이프라인 현황 분석을 도와드립니다. 수주 가능성이 높은 리드를 알아볼까요?',
      customers: '고객사 브리핑이나 영업 전략을 도와드립니다.',
      reports: '주간/월간 보고서를 생성해드릴 수 있습니다. "주간보고서 작성해줘"라고 입력해보세요.',
      default: 'OCI CRM AI 어시스턴트입니다. 영업 현황, 리드 분석, 보고서 작성 등을 도와드립니다.',
    };
    const text = welcomes[ctx] || welcomes.default;
    this.appendBotMessage(text);
  },

  // ── SSE 스트림 공통 처리 ─────────────────────────────────
  async _readStream(response, botDiv, onDone) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // 마지막 불완전 줄 보존

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') {
          reader.cancel();
          break;
        }
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            botDiv.innerHTML = `<span style="color:#ff6b6b">⚠️ AI 오류: ${esc(parsed.error)}</span>`;
            return fullText;
          }
          if (parsed.text) {
            fullText += parsed.text;
            botDiv.innerHTML = this.renderMarkdown(fullText) + '<span class="ai-cursor">▋</span>';
            botDiv.parentElement.scrollTop = botDiv.parentElement.scrollHeight;
          }
        } catch (_) {
          /* malformed SSE JSON line, skip */
        }
      }
    }
    botDiv.innerHTML = this.renderMarkdown(fullText);
    if (onDone) onDone(fullText);
    return fullText;
  },

  // ── 메시지 전송 ──────────────────────────────────────────
  async send() {
    const input = document.getElementById('ai-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.style.height = 'auto';

    this.messages.push({ role: 'user', content: text });
    this.appendUserMessage(text);

    if (await this.handleQuickCommand(text)) return;

    const botDiv = this.appendBotMessage('', true);

    try {
      const ctrl = new AbortController();
      this.currentStream = ctrl;

      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: this._authHeaders(),
        body: JSON.stringify({ messages: this.messages.slice(-12) }),
        signal: ctrl.signal,
      });

      if (!res.ok) throw new Error(`서버 오류 (${res.status})`);

      const fullText = await this._readStream(res, botDiv);
      if (fullText) this.messages.push({ role: 'assistant', content: fullText });
    } catch (err) {
      if (err.name !== 'AbortError') {
        botDiv.innerHTML = `<span style="color:#ff6b6b">⚠️ ${esc(err.message)}</span>`;
      }
    } finally {
      this.currentStream = null;
    }
  },

  // ── 빠른 명령어 ──────────────────────────────────────────
  async handleQuickCommand(text) {
    const t = text.toLowerCase();
    const isPpt = t.includes('ppt') || t.includes('파워포인트') || t.includes('슬라이드');
    const isWord = t.includes('word') || t.includes('워드') || t.includes('docx');
    const formats = isPpt ? ['pptx'] : isWord ? ['docx'] : ['docx', 'pptx'];

    // ── 보고서 신규 생성 ──────────────────────────────────
    if (t.includes('주간보고') || t.includes('주간 보고')) {
      this.streamReport('weekly', formats);
      return true;
    }
    if (t.includes('월간보고') || t.includes('월간 보고')) {
      this.streamReport('monthly', formats);
      return true;
    }

    // ── 파일 포맷 + 행동 의도 감지 ────────────────────────
    // 예) "ppt로 정리해줘", "수주예측 워드로 만들어줘", "입찰현황 ppt 생성해줘"
    const isDlIntent =
      t.includes('다운로드') ||
      t.includes('저장') ||
      t.includes('뽑아') ||
      t.includes('내려받') ||
      t.includes('파일로') ||
      t.includes('파일 생성') ||
      t.includes('만들어') ||
      t.includes('만들줘') ||
      t.includes('생성해') ||
      t.includes('변환') ||
      t.includes('출력') ||
      t.includes('정리해') ||
      t.includes('정리줘') ||
      t.includes('작성해') ||
      t.includes('작성줘') ||
      t.includes('써줘') ||
      t.includes('요약해') ||
      t.includes('보고서') ||
      t.includes('리포트');

    if ((isPpt || isWord) && isDlIntent) {
      // 파일 키워드·행동 키워드를 제거하고 남은 '주제' 추출
      const topic = text
        .replace(/pptx?(?:파일)?|파워포인트|슬라이드/gi, '')
        .replace(/word|워드|docx/gi, '')
        .replace(
          /다운로드|저장|파일\s*생성|만들어\s*줘?|만들줘|생성해\s*줘?|변환해?\s*줘?|출력해?\s*줘?/gi,
          ''
        )
        .replace(/정리해\s*줘?|작성해\s*줘?|써\s*줘|요약해\s*줘?|뽑아\s*줘?|내려받아?\s*줘?/gi, '')
        .replace(/보고서|리포트|파일|자료|문서|파일로/gi, '')
        .replace(/(?:^|\s)으?로(?:\s|$)/g, ' ') // 단독 조사 "로/으로" 제거
        .replace(/(?:^|\s)해줘?(?:\s|$)/g, ' ') // 단독 "해줘" 제거
        .replace(/(?:^|\s)줘(?:\s|$)/g, ' ') // 단독 "줘" 제거
        .replace(/\s+/g, ' ')
        .trim();

      return await this._handleFileRequest(isPpt ? 'pptx' : 'docx', formats, topic);
    }

    return false;
  },

  // ── 파일 요청 통합 처리 ──────────────────────────────────
  // topic이 있으면 → AI로 내용 생성 후 다운로드 바
  // topic 없으면 → 기존 대화 내용 재활용
  async _handleFileRequest(preferredFmt, formats, topic) {
    const hasTopic = topic && topic.length >= 2;

    // ① 주제 있음 → 새 내용 생성 후 다운로드 바 표시
    if (hasTopic) {
      return await this._streamTopicReport(topic, preferredFmt);
    }

    // ② 화면에 다운로드 바 이미 존재 → 해당 포맷 버튼 클릭
    const bars = [...document.querySelectorAll('.ai-dl-bar')];
    if (bars.length > 0) {
      const lastBar = bars[bars.length - 1];
      let btn = lastBar.querySelector(`.ai-dl-file[data-fmt="${preferredFmt}"]`);
      if (!btn) btn = lastBar.querySelector('.ai-dl-file'); // 다른 포맷이라도
      if (btn) {
        const fmt = btn.dataset.fmt;
        this.appendBotMessage(`📎 ${fmt.toUpperCase()} 파일을 생성합니다... 잠시만 기다려 주세요.`);
        btn.click();
        return true;
      }
      // 바는 있지만 버튼 없음 → 내용 재사용해 새 포맷 바 추가
      const content = decodeURIComponent(lastBar.dataset.content || '');
      const title = decodeURIComponent(lastBar.dataset.title || '');
      if (content && title) {
        const botDiv = this.appendBotMessage('✅ 파일 아이콘을 클릭하면 다운로드됩니다.');
        this._appendDownloadBar(botDiv.parentElement, content, title, [preferredFmt]);
        return true;
      }
    }

    // ③ 대화 기록에서 마지막 AI 응답 재활용 (200자 이상)
    const lastMsg = [...this.messages]
      .reverse()
      .find(m => m.role === 'assistant' && m.content.length > 200);
    if (lastMsg) {
      const now = new Date();
      const ds = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
      const docTitle = `OCI_영업_보고서_${ds}`;
      const botDiv = this.appendBotMessage(
        `📊 이전 내용으로 ${preferredFmt.toUpperCase()} 파일을 준비합니다...`
      );
      this._appendDownloadBar(botDiv.parentElement, lastMsg.content, docTitle, [preferredFmt]);
      botDiv.innerHTML = '✅ 파일 아이콘을 클릭하면 다운로드됩니다.';
      return true;
    }

    // ④ 맥락 없음 → 일반 채팅으로 넘김
    return false;
  },

  // ── 주제별 보고서 스트리밍 생성 → 다운로드 바 ────────────────
  async _streamTopicReport(topic, fmt) {
    const botDiv = this.appendBotMessage(`📊 "${topic}" 보고서를 작성합니다...`, true);
    try {
      // 현재 대화 맥락을 포함해 보고서 작성 요청
      const prompt =
        `다음 주제에 대해 OCI 영업팀을 위한 보고서를 작성해줘.\n` +
        `마크다운 형식(# 제목, ## 소제목, - 항목)으로 구성하고, ` +
        `표가 필요하면 마크다운 테이블을 사용해줘.\n주제: ${topic}`;
      const messages = [...this.messages.slice(-8), { role: 'user', content: prompt }];
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: this._authHeaders(),
        body: JSON.stringify({ messages }),
      });
      if (!res.ok) throw new Error(`서버 오류 (${res.status})`);
      const fullText = await this._readStream(res, botDiv);
      if (fullText) {
        this.messages.push({ role: 'assistant', content: fullText });
        const now = new Date();
        const ds = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
        const safeTopic = topic.replace(/[^가-힣a-zA-Z0-9]/g, '_').slice(0, 18);
        const docTitle = `OCI_${safeTopic}_${ds}`;
        this._appendDownloadBar(botDiv.parentElement, fullText, docTitle, [fmt]);
      }
    } catch (err) {
      botDiv.innerHTML = `<span style="color:#ff6b6b">⚠️ 내용 생성 실패: ${esc(err.message)}</span>`;
    }
    return true;
  },

  async streamReport(type, formats = ['docx', 'pptx']) {
    const label = type === 'weekly' ? '주간' : '월간';
    const botDiv = this.appendBotMessage(`📊 ${label} 보고서를 작성합니다...`, true);
    try {
      const res = await fetch('/api/ai/report', {
        method: 'POST',
        headers: this._authHeaders(),
        body: JSON.stringify({ type }),
      });
      if (!res.ok) throw new Error(`서버 오류 (${res.status})`);
      const fullText = await this._readStream(res, botDiv);
      if (fullText) {
        this.messages.push({ role: 'assistant', content: fullText });
        // 보고서 완료 → 다운로드 버튼 표시
        const now = new Date();
        const ds = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
        const docTitle = `OCI_영업_${label}보고서_${ds}`;
        this._appendDownloadBar(botDiv.parentElement, fullText, docTitle, formats);
      }
    } catch (err) {
      botDiv.innerHTML = `<span style="color:#ff6b6b">⚠️ 보고서 생성 실패: ${esc(err.message)}</span>`;
    }
  },

  // ── 다운로드 파일 아이콘 바 ──────────────────────────────────
  _appendDownloadBar(msgWrap, content, docTitle, formats = ['docx', 'pptx']) {
    // 기존 다운로드 바 제거 (msgWrap 다음 형제에 있을 수 있음)
    const next = msgWrap.nextElementSibling;
    if (next && next.classList.contains('ai-dl-bar')) next.remove();

    const FMT_META = {
      docx: {
        ext: '.docx',
        label: 'Word 문서',
        iconBg: '#1e3a70',
        iconAccent: '#2b5fcc',
        textColor: '#7ab3ff',
        extText: 'DOCX',
      },
      pptx: {
        ext: '.pptx',
        label: 'PowerPoint',
        iconBg: '#601800',
        iconAccent: '#cc4a2b',
        textColor: '#ff8a7a',
        extText: 'PPTX',
      },
    };

    const shortName = docTitle.length > 14 ? docTitle.slice(0, 14) + '…' : docTitle;

    const filesHtml = formats
      .map(fmt => {
        const m = FMT_META[fmt];
        if (!m) return '';
        return `
        <button class="ai-dl-file" data-fmt="${fmt}" title="${m.label} 다운로드 (${docTitle}${m.ext})">
          <svg class="ai-dl-file-svg" width="48" height="60" viewBox="0 0 48 60">
            <rect x="0" y="0" width="48" height="60" rx="5" fill="${m.iconBg}"/>
            <path d="M30 0 L48 18 L48 60 Q48 60 30 60 L0 60 Q0 60 0 0 Z" fill="${m.iconBg}"/>
            <path d="M30 0 L30 18 L48 18 Z" fill="${m.iconAccent}" opacity="0.6"/>
            <rect x="6" y="30" width="36" height="6" rx="2" fill="${m.iconAccent}" opacity="0.8"/>
            <rect x="6" y="40" width="28" height="5" rx="2" fill="${m.iconAccent}" opacity="0.5"/>
            <text x="24" y="56" text-anchor="middle" font-size="8" font-weight="700" fill="${m.textColor}" font-family="Arial,sans-serif">${m.extText}</text>
          </svg>
          <span class="ai-dl-file-name">${shortName}${m.ext}</span>
        </button>`;
      })
      .join('');

    const bar = document.createElement('div');
    bar.className = 'ai-dl-bar';
    bar.dataset.content = encodeURIComponent(content);
    bar.dataset.title = encodeURIComponent(docTitle);
    bar.innerHTML = `
      <span class="ai-dl-label">📥 파일 다운로드</span>
      <div class="ai-dl-files">${filesHtml}</div>`;

    // msgWrap(.ai-msg-bot) 다음 형제로 삽입 → flex 레이아웃 깨짐 방지
    msgWrap.parentNode.insertBefore(bar, msgWrap.nextSibling);

    // 클릭 이벤트 연결
    bar.querySelectorAll('.ai-dl-file').forEach(btn => {
      btn.addEventListener('click', () => this._doDownload(btn));
    });
  },

  async _doDownload(btn) {
    const bar = btn.closest('.ai-dl-bar');
    const fmt = btn.dataset.fmt;
    const content = decodeURIComponent(bar.dataset.content);
    const title = decodeURIComponent(bar.dataset.title);

    // 버튼 로딩 상태
    const origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.style.opacity = '0.6';
    const svg = btn.querySelector('.ai-dl-file-svg');
    if (svg) svg.style.filter = 'grayscale(1)';
    const nameEl = btn.querySelector('.ai-dl-file-name');
    if (nameEl) nameEl.textContent = '⏳ 생성중...';

    try {
      const res = await fetch('/api/ai/export', {
        method: 'POST',
        headers: this._authHeaders(),
        body: JSON.stringify({ format: fmt, content, title }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '생성 실패' }));
        throw new Error(err.error || '생성 실패');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title}.${fmt}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      Toast.success(`${fmt.toUpperCase()} 파일이 다운로드되었습니다 🎉`);
    } catch (err) {
      Toast.error('다운로드 실패: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.style.opacity = '';
      btn.innerHTML = origHtml;
      // 이벤트 재연결 (innerHTML 교체 후)
      btn.addEventListener('click', () => this._doDownload(btn));
    }
  },

  // ── 고객사 브리핑 (외부 호출용) ─────────────────────────
  async briefCustomer(customerId, customerName) {
    this.open();
    this.appendUserMessage(`${customerName} 고객사 브리핑 해줘`);
    const botDiv = this.appendBotMessage('', true);
    try {
      const res = await fetch(`/api/ai/briefing/${customerId}`, { headers: this._authHeaders() });
      if (!res.ok) throw new Error(`서버 오류 (${res.status})`);
      const fullText = await this._readStream(res, botDiv);
      if (fullText) {
        this.messages.push({ role: 'assistant', content: fullText });
        const now = new Date();
        const ds = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
        this._appendDownloadBar(
          botDiv.parentElement,
          fullText,
          `OCI_${customerName}_고객사브리핑_${ds}`,
          ['docx', 'pptx']
        );
        // ✅ 고객사 화면 브리핑 완료 배지 업데이트
        localStorage.setItem(`oci_brief_${customerId}`, new Date().toISOString());
        if (App.currentPage === 'customers' && window.CustomersPage?._refreshBriefBadge) {
          CustomersPage._refreshBriefBadge(customerId);
        }
      }
    } catch (err) {
      botDiv.innerHTML = `<span style="color:#ff6b6b">⚠️ 브리핑 생성 실패: ${esc(err.message)}</span>`;
    }
  },

  // ── 리드 요약 (외부 호출용) ─────────────────────────────
  async summarizeLead(leadId, leadName) {
    this.open();
    this.appendUserMessage(`"${leadName}" 리드 영업 현황 요약해줘`);
    const botDiv = this.appendBotMessage('', true);
    try {
      const res = await fetch(`/api/ai/summary/${leadId}`, { headers: this._authHeaders() });
      if (!res.ok) throw new Error(`서버 오류 (${res.status})`);
      const fullText = await this._readStream(res, botDiv);
      if (fullText) {
        this.messages.push({ role: 'assistant', content: fullText });
        const now = new Date();
        const ds = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
        const safeName = leadName.replace(/[^가-힣a-zA-Z0-9]/g, '_').slice(0, 20);
        this._appendDownloadBar(botDiv.parentElement, fullText, `OCI_${safeName}_영업요약_${ds}`, [
          'docx',
          'pptx',
        ]);
      }
    } catch (err) {
      botDiv.innerHTML = `<span style="color:#ff6b6b">⚠️ 요약 생성 실패: ${esc(err.message)}</span>`;
    }
  },

  // ── 회의록 요약 ──────────────────────────────────────────
  async processMeetingNotes(text, customerName) {
    const botDiv = this.appendBotMessage('', true);
    try {
      const res = await fetch('/api/ai/meeting-notes', {
        method: 'POST',
        headers: this._authHeaders(),
        body: JSON.stringify({ text, customer_name: customerName }),
      });
      if (!res.ok) throw new Error(`서버 오류 (${res.status})`);
      const fullText = await this._readStream(res, botDiv);
      if (fullText) this.messages.push({ role: 'assistant', content: fullText });
    } catch (err) {
      botDiv.innerHTML = `<span style="color:#ff6b6b">⚠️ 회의록 처리 실패: ${esc(err.message)}</span>`;
    }
  },

  // ── DOM 헬퍼 ─────────────────────────────────────────────
  appendUserMessage(text) {
    const list = document.getElementById('ai-message-list');
    const div = document.createElement('div');
    div.className = 'ai-msg ai-msg-user';
    div.textContent = text;
    list.appendChild(div);
    list.scrollTop = list.scrollHeight;
    return div;
  },

  appendBotMessage(text, isStreaming = false) {
    const list = document.getElementById('ai-message-list');
    const wrap = document.createElement('div');
    wrap.className = 'ai-msg ai-msg-bot';

    const icon = document.createElement('div');
    icon.className = 'ai-bot-icon';
    icon.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a2 2 0 012 2v2h2a2 2 0 012 2v1a3 3 0 010 6v1a2 2 0 01-2 2h-2v2a2 2 0 01-4 0v-2H8a2 2 0 01-2-2v-1a3 3 0 010-6V8a2 2 0 012-2h2V4a2 2 0 012-2z"/><circle cx="9" cy="12" r="1" fill="currentColor"/><circle cx="15" cy="12" r="1" fill="currentColor"/></svg>';

    const content = document.createElement('div');
    content.className = 'ai-msg-content';
    if (isStreaming && !text) {
      content.innerHTML = '<span class="ai-cursor">▋</span>';
    } else {
      content.innerHTML = this.renderMarkdown(text);
    }

    wrap.appendChild(icon);
    wrap.appendChild(content);
    list.appendChild(wrap);
    list.scrollTop = list.scrollHeight;
    return content;
  },

  renderMarkdown(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/^## (.+)$/gm, '<h4 class="ai-h4">$1</h4>')
      .replace(/^### (.+)$/gm, '<h5 class="ai-h5">$1</h5>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
      .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>')
      .replace(/^(.)/gm, (m, c) => c);
  },

  clearChat() {
    this.messages = [];
    document.getElementById('ai-message-list').innerHTML = '';
    this.addWelcome();
  },

  copyLastMessage() {
    const msgs = document.querySelectorAll('.ai-msg-bot .ai-msg-content');
    if (!msgs.length) return;
    const last = msgs[msgs.length - 1].innerText;
    navigator.clipboard.writeText(last).then(() => Toast.success('복사되었습니다'));
  },
};

// ── 알림 시스템 ──────────────────────────────────────────────
const Notifications = {
  count: 0,
  items: [],

  async load() {
    try {
      // 기능 토글 OFF 시 호출 자체 skip (Circuit Breaker)
      if (typeof Features !== 'undefined' && !Features.isEnabled('crm.notifications')) {
        this.items = [];
        this.count = 0;
        this.updateBadge();
        return;
      }
      const res = await API.get('/notifications');
      this.items = res.data || [];
      this.count = this.items.length;
      this.updateBadge();
      // 패널이 열려있으면 즉시 리렌더 (WS 이벤트로 호출된 경우 반영)
      const panel = document.getElementById('notif-panel');
      if (panel?.classList.contains('show')) this.renderItems(panel);
    } catch (_) {
      /* notification load failure is non-critical */
    }
  },

  updateBadge() {
    const badge = document.getElementById('notif-badge');
    const dot = document.querySelector('.badge-dot');
    if (badge) badge.textContent = this.count || '';
    if (dot) dot.style.display = this.count > 0 ? 'block' : 'none';
  },

  showPanel() {
    const panel = document.getElementById('notif-panel');
    if (!panel) return;
    panel.classList.toggle('show');
    if (panel.classList.contains('show')) this.renderItems(panel);
  },

  renderItems(panel) {
    if (!this.items.length) {
      panel.querySelector('.notif-list').innerHTML =
        '<div class="empty" style="padding:20px;text-align:center;color:var(--text-3)">알림이 없습니다</div>';
      return;
    }

    // 패널에는 최대 20개만 표시
    const PANEL_LIMIT = 20;
    const displayItems = this.items.slice(0, PANEL_LIMIT);
    const hasMore = this.items.length > PANEL_LIMIT;

    const META = {
      마감초과: { icon: '🚨', color: 'red', dateLabel: '초과일', urgent: true },
      입찰마감: { icon: '📋', color: 'red', dateLabel: '마감일', urgent: true },
      마감임박: { icon: '⏰', color: 'amber', dateLabel: '마감일', urgent: true },
      납기임박: { icon: '🏭', color: 'amber', dateLabel: '납기일', urgent: true },
      오늘일정: { icon: '📅', color: 'blue', dateLabel: '일정', urgent: false },
      수주완료: { icon: '🏆', color: 'green', dateLabel: '완료일', urgent: false },
      단계변경: { icon: '🔄', color: 'blue', dateLabel: '변경일', urgent: false },
      회의록등록: { icon: '📝', color: 'green', dateLabel: '등록일', urgent: false },
      리드등록: { icon: '🎯', color: 'purple', dateLabel: '등록일', urgent: false },
      고객사등록: { icon: '🏢', color: 'purple', dateLabel: '등록일', urgent: false },
      활동등록: { icon: '✍️', color: 'gray', dateLabel: '등록일', urgent: false },
    };

    // 시간순(최신↓) 정렬 후 날짜 그룹핑 — 사용자가 알림 벨을 클릭하는 의도는
    // "뭐가 새로 생겼나" 이므로 최근 항목이 위에 와야 함. urgent 표시는
    // 색상 코딩된 아이콘(red/amber 배경)으로 시각 구분 유지.
    const sortedDisplay = Notifications._sortByRecency(displayItems);
    const groups = Notifications._groupByDate(sortedDisplay);

    const renderGroup = (items, groupLabel) => {
      if (!items.length) return '';
      const header = `<div style="padding:6px 14px 4px;font-size:10px;font-weight:700;
                        color:var(--text-3);letter-spacing:.5px;text-transform:uppercase;
                        border-top:1px solid var(--border)">${groupLabel}</div>`;
      const rows = items
        .map(n => {
          const m = META[n.type] || { icon: '🔔', color: 'amber', dateLabel: '일자' };
          const daysTag =
            n.type === '마감초과' && n.days_left > 0
              ? `<span style="color:#E63329;font-weight:700">D+${n.days_left}</span>`
              : n.days_left > 0
                ? `<span style="color:var(--text-3)">D-${n.days_left}</span>`
                : '';
          const dateStr = n.due_date ? Fmt.date(n.due_date) : '';

          // 단계변경: "프로젝트명 → 변경된단계" 형태로 표시
          const STAGE_LABELS = {
            lead: '리드발굴',
            review: '검토',
            proposal: '제안',
            bidding: '입찰',
            negotiation: '협상',
            won: '수주',
            dropped: '드롭',
          };
          let descHtml;
          if (n.type === '단계변경' && n.stage_detail) {
            const arrow = n.stage_detail.replace('단계 변경: ', '');
            descHtml =
              `<span>${esc(n.project_name || '')}</span>` +
              `<span style="color:var(--oci-blue,#1a73e8);font-weight:600;margin-left:4px">→ ${esc(arrow)}</span>`;
          } else {
            descHtml = esc(n.project_name || n.stage || '');
          }

          return `
          <div class="notif-item" data-notif-type="${esc(n.type)}" data-notif-id="${n.id}" style="cursor:pointer">
            <div class="notif-icon ${m.color}">${m.icon}</div>
            <div class="notif-body">
              <div class="notif-title">
                <span style="font-weight:600">${esc(n.type)}</span>
                ${n.customer_name ? `<span style="color:var(--text-2);margin-left:4px">· ${esc(n.customer_name)}</span>` : ''}
              </div>
              <div class="notif-desc">${descHtml}</div>
              <div class="notif-date">${m.dateLabel}: ${dateStr} ${daysTag}</div>
            </div>
          </div>`;
        })
        .join('');
      return header + rows;
    };

    const moreFooter = hasMore
      ? `<div style="border-top:1px solid var(--border);padding:10px 14px;text-align:center">
           <button class="btn btn-ghost btn-sm notif-view-all-btn" style="width:100%;font-size:12px;color:var(--text-2)">
             📋 전체 알림 보기 (${this.items.length}건) →
           </button>
         </div>`
      : `<div style="border-top:1px solid var(--border);padding:8px 14px;text-align:center">
           <button class="btn btn-ghost btn-sm notif-view-all-btn" style="width:100%;font-size:12px;color:var(--text-2)">
             📋 전체 알림 목록 보기 →
           </button>
         </div>`;

    const notifList = panel.querySelector('.notif-list');
    notifList.innerHTML =
      renderGroup(groups.today, '📅 오늘') +
      renderGroup(groups.week, '🗓 최근 7일') +
      renderGroup(groups.month, '📆 이번 달') +
      renderGroup(groups.older, '📋 이전') +
      moreFooter;

    notifList.addEventListener('click', e => {
      const item = e.target.closest('.notif-item[data-notif-id]');
      if (item) {
        this.navigateTo(item.dataset.notifType, parseInt(item.dataset.notifId));
        return;
      }
      if (e.target.closest('.notif-view-all-btn')) {
        this.showPanel();
        App.navigate('notifications');
      }
    });
  },

  // ── Helpers (드롭다운 + 전체보기 페이지 양쪽에서 재사용) ────────
  /**
   * 시간순(최신↓) 정렬 — due_date DESC, id DESC fallback
   */
  _sortByRecency(items) {
    return [...items].sort((a, b) => {
      const ta = a.due_date ? new Date(a.due_date).getTime() : 0;
      const tb = b.due_date ? new Date(b.due_date).getTime() : 0;
      if (tb !== ta) return tb - ta; // 최신 날짜가 위
      return (b.id || 0) - (a.id || 0); // 동일 날짜면 id 큰 것이 위
    });
  },
  /**
   * 오늘 기준 거리로 그룹핑 (과거/미래 대칭)
   *   today  : |diff| < 1일
   *   week   : 1~7일
   *   month  : 8~30일
   *   older  : 30일 초과 또는 due_date 없음
   */
  _groupByDate(items) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const DAY = 86400000;
    const groups = { today: [], week: [], month: [], older: [] };
    items.forEach(n => {
      if (!n.due_date) {
        groups.older.push(n);
        return;
      }
      const d = new Date(n.due_date);
      d.setHours(0, 0, 0, 0);
      const diffDays = Math.abs((d - today) / DAY);
      if (diffDays < 1) groups.today.push(n);
      else if (diffDays <= 7) groups.week.push(n);
      else if (diffDays <= 30) groups.month.push(n);
      else groups.older.push(n);
    });
    return groups;
  },

  navigateTo(type, id) {
    document.getElementById('notif-panel')?.classList.remove('show');

    // 알림 아이템에서 추가 데이터 (lead_id, due_date, customer_name) 가져오기
    const item = this.items.find(n => n.type === type && String(n.id) === String(id)) || {};
    const leadId = item.lead_id || null;
    const dueDateStr = item.due_date ? String(item.due_date).slice(0, 10) : '';
    const custName = item.customer_name || '';

    // ── 리드 상세를 직접 여는 헬퍼 ──────────────────────────
    const openLead = (lid, page = 'leads') => {
      App.navigate(page).then(() => {
        if (lid) App.openLeadDetail(lid);
      });
    };

    switch (type) {
      // ─── 리드 기반 알림 → 해당 리드 상세 모달 ───────────
      case '마감초과':
      case '입찰마감':
      case '마감임박':
      case '리드등록':
        openLead(id, 'leads');
        break;

      case '수주완료':
      case '단계변경':
        openLead(id, 'pipeline');
        break;

      // ─── 프로젝트 납기 임박 → lead_id 있으면 리드 상세, 없으면 파이프라인 ──
      case '납기임박':
        if (leadId) openLead(leadId, 'pipeline');
        else App.navigate('pipeline');
        break;

      // ─── 영업 활동 → lead_id 있으면 리드 상세 ───────────
      case '활동등록':
        if (leadId) openLead(leadId, 'leads');
        else App.navigate('leads');
        break;

      // ─── 오늘 일정 → 캘린더 해당 일정 상세 모달 ─────────
      case '오늘일정':
        App.navigate('calendar').then(() => {
          setTimeout(() => {
            if (typeof CalendarPage !== 'undefined' && CalendarPage.openEventById) {
              CalendarPage.openEventById(id, dueDateStr);
            }
          }, 350);
        });
        break;

      // ─── 회의록 → 목록 이동 후 해당 회의록 자동 오픈 ────
      case '회의록등록':
        if (typeof MeetingListPage !== 'undefined') MeetingListPage._pendingId = id;
        App.navigate('meeting-list');
        break;

      // ─── 고객사 → 고객사 인텔리전스 패널 바로 오픈 ──────
      case '고객사등록':
        App.navigate('customers').then(() => {
          setTimeout(() => {
            if (typeof CustomersPage !== 'undefined' && CustomersPage.showIntel) {
              CustomersPage.showIntel(id, custName);
            }
          }, 350);
        });
        break;

      default:
        App.navigate('dashboard');
    }
  },
};

// ── 퀵 액션 패널 ────────────────────────────────────────────
const QuickActions = [
  {
    label: '주간 보고서',
    icon: '📊',
    action: () => {
      AI.open();
      AI.streamReport('weekly');
    },
  },
  {
    label: '파이프라인 분석',
    icon: '🔍',
    action: () => {
      AI.open();
      document.getElementById('ai-input').value = '현재 파이프라인 분석해줘';
      AI.send();
    },
  },
  {
    label: '수주 리스크',
    icon: '⚠️',
    action: () => {
      AI.open();
      document.getElementById('ai-input').value = '수주 가능성이 낮거나 리스크가 있는 리드 알려줘';
      AI.send();
    },
  },
  {
    label: '다음 액션',
    icon: '🎯',
    action: () => {
      AI.open();
      document.getElementById('ai-input').value = '이번 주 영업팀이 집중해야 할 액션 아이템 알려줘';
      AI.send();
    },
  },
];
