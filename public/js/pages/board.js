/* ============================================================
   board.js — Communication Board page for OCI CRM SPA
   Tabs: 공지사항 | FAQ | 댓글/알림
   ============================================================ */

const BoardPage = (() => {
  /* ──────────────────────────────────────────────
     State
  ────────────────────────────────────────────── */
  let _activeTab = 'announcements';
  let _announcements = [];
  let _faqs = [];
  let _recentComments = [];
  let _quillInstance = null;

  /* ──────────────────────────────────────────────
     Helpers
  ────────────────────────────────────────────── */
  function _groupBy(arr, key) {
    return arr.reduce((acc, item) => {
      const k = item[key] || '기타';
      if (!acc[k]) acc[k] = [];
      acc[k].push(item);
      return acc;
    }, {});
  }

  function _destroyQuill() {
    _quillInstance = null;
  }

  function _initQuill(selector) {
    _destroyQuill();
    try {
      _quillInstance = new Quill(selector, {
        theme: 'snow',
        placeholder: '내용을 입력하세요...',
      });
    } catch (e) {
      console.error('Quill init failed:', e);
    }
    return _quillInstance;
  }

  /* ──────────────────────────────────────────────
     Tab rendering
  ────────────────────────────────────────────── */
  function _renderTabBar() {
    const tabs = [
      { id: 'announcements', label: '공지사항' },
      { id: 'faq', label: 'FAQ' },
      { id: 'comments', label: '댓글/알림' },
    ];
    return `
      <div class="tab-bar" style="display:flex;gap:4px;margin-bottom:20px;border-bottom:2px solid var(--border,#e5e7eb);">
        ${tabs
          .map(
            t => `
          <button
            class="tab-btn${_activeTab === t.id ? ' active' : ''}"
            data-tab="${t.id}"
            style="padding:10px 22px;border:none;background:none;cursor:pointer;font-size:14px;font-weight:600;
                   color:${_activeTab === t.id ? 'var(--primary,#4f46e5)' : 'var(--text-muted,#6b7280)'};
                   border-bottom:${_activeTab === t.id ? '2px solid var(--primary,#4f46e5)' : '2px solid transparent'};
                   margin-bottom:-2px;transition:color .15s,border-color .15s;">
            ${esc(t.label)}
          </button>
        `
          )
          .join('')}
      </div>`;
  }

  /* ──────────────────────────────────────────────
     공지사항 Tab
  ────────────────────────────────────────────── */
  function _renderAnnouncements() {
    const pinned = _announcements.filter(a => a.is_pinned);
    const unpinned = _announcements.filter(a => !a.is_pinned);
    const sorted = [...pinned, ...unpinned];

    return `
      <div class="card">
        <div class="card-header" style="display:flex;align-items:center;justify-content:space-between;">
          <span class="card-title">공지사항</span>
          <button class="btn btn-primary" id="btn-new-announcement">+ 새 공지</button>
        </div>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <thead>
              <tr style="border-bottom:1px solid var(--border,#e5e7eb);text-align:left;">
                <th style="padding:10px 12px;font-weight:600;color:var(--text-muted,#6b7280);">제목</th>
                <th style="padding:10px 12px;font-weight:600;color:var(--text-muted,#6b7280);width:120px;">작성자</th>
                <th style="padding:10px 12px;font-weight:600;color:var(--text-muted,#6b7280);width:110px;">날짜</th>
                <th style="padding:10px 12px;font-weight:600;color:var(--text-muted,#6b7280);width:70px;text-align:center;">댓글</th>
                <th style="padding:10px 12px;width:90px;"></th>
              </tr>
            </thead>
            <tbody id="announcements-tbody">
              ${
                sorted.length === 0
                  ? `
                <tr><td colspan="5" style="padding:32px;text-align:center;color:var(--text-muted,#6b7280);">등록된 공지사항이 없습니다.</td></tr>
              `
                  : sorted
                      .map(
                        a => `
                <tr data-ann-id="${a.id}" style="border-bottom:1px solid var(--border,#e5e7eb);transition:background .1s;" onmouseover="this.style.background='var(--surface-hover,#f9fafb)'" onmouseout="this.style.background=''">
                  <td style="padding:12px 12px;">
                    ${a.is_pinned ? '<span class="badge" style="background:#fef3c7;color:#92400e;margin-right:6px;font-size:11px;padding:2px 6px;border-radius:4px;">📌 고정</span>' : ''}
                    <span style="font-weight:${a.is_pinned ? '600' : '400'};">${esc(a.title)}</span>
                  </td>
                  <td style="padding:12px 12px;color:var(--text-muted,#6b7280);">${esc(a.created_by_name || '-')}</td>
                  <td style="padding:12px 12px;color:var(--text-muted,#6b7280);">${Fmt.date(a.created_at)}</td>
                  <td style="padding:12px 12px;text-align:center;">
                    ${a.comment_count > 0 ? `<span class="badge" style="background:var(--primary-light,#ede9fe);color:var(--primary,#4f46e5);font-size:12px;padding:2px 8px;border-radius:10px;">${a.comment_count}</span>` : '<span style="color:var(--text-muted,#6b7280);">-</span>'}
                  </td>
                  <td style="padding:12px 12px;">
                    <button class="btn btn-ghost btn-detail-ann" data-id="${a.id}" style="font-size:12px;padding:4px 10px;">상세보기</button>
                  </td>
                </tr>
              `
                      )
                      .join('')
              }
            </tbody>
          </table>
        </div>
      </div>`;
  }

  function _openNewAnnouncementModal() {
    const body = `
      <div style="display:flex;flex-direction:column;gap:16px;">
        <div>
          <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;">제목 <span style="color:#ef4444;">*</span></label>
          <input id="ann-title" class="form-input" type="text" placeholder="공지 제목을 입력하세요" style="width:100%;">
        </div>
        <div>
          <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;">내용 <span style="color:#ef4444;">*</span></label>
          <div id="quill-editor" style="min-height:180px;background:var(--surface);color:var(--text-1);"></div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <input id="ann-pinned" type="checkbox" style="width:16px;height:16px;cursor:pointer;">
          <label for="ann-pinned" style="font-size:13px;cursor:pointer;">상단 고정 (📌 Pinned)</label>
        </div>
      </div>`;

    const footer = `
      <button class="btn btn-ghost" id="ann-cancel-btn">취소</button>
      <button class="btn btn-primary" id="ann-save-btn">저장</button>`;

    Modal.open({ title: '새 공지사항 등록', body, footer, width: '640px' });

    setTimeout(() => {
      _initQuill('#quill-editor');

      document.getElementById('ann-cancel-btn').addEventListener('click', () => {
        _destroyQuill();
        Modal.close();
      });

      document.getElementById('ann-save-btn').addEventListener('click', async () => {
        const title = (document.getElementById('ann-title').value || '').trim();
        const content = _quillInstance ? _quillInstance.root.innerHTML : '';
        const isPinned = document.getElementById('ann-pinned').checked;

        if (!title) {
          Toast.error('제목을 입력해주세요.');
          return;
        }
        const textContent = _quillInstance ? _quillInstance.getText().trim() : '';
        if (!textContent) {
          Toast.error('내용을 입력해주세요.');
          return;
        }

        try {
          document.getElementById('ann-save-btn').disabled = true;
          await API.post('/board/announcements', { title, content, is_pinned: isPinned });
          Toast.success('공지사항이 등록되었습니다.');
          _destroyQuill();
          Modal.close();
          await _loadAnnouncements();
          _rerenderTab();
        } catch (_e) {
          Toast.error('저장에 실패했습니다.');
          document.getElementById('ann-save-btn').disabled = false;
        }
      });
    }, 80);
  }

  async function _openAnnouncementDetail(id) {
    const ann = _announcements.find(a => a.id === id);
    if (!ann) return;

    // 열람 기록 (비동기, 실패해도 무관)
    const viewerId = parseInt(localStorage.getItem('current_user_id') || '0');
    if (viewerId) {
      API.post(`/board/announcements/${id}/view`, { viewer_id: viewerId }).catch(() => {});
    }

    let comments = [];
    try {
      const res = await API.get(`/board/comments?ref_type=announcement&ref_id=${id}`);
      comments = res.data || [];
    } catch (_) {
      comments = [];
    }

    function buildCommentList(list) {
      if (!list.length)
        return '<p style="color:var(--text-muted,#6b7280);font-size:13px;padding:8px 0;">아직 댓글이 없습니다.</p>';
      return list
        .map(
          c => `
        <div class="comment-item" data-cid="${c.id}" style="border-bottom:1px solid var(--border,#e5e7eb);padding:10px 0;display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <div style="flex:1;">
            <div style="font-size:13px;font-weight:600;color:var(--text,#111827);">${esc(c.author_name || '익명')}</div>
            <div style="font-size:13px;color:var(--text,#374151);margin-top:3px;white-space:pre-wrap;">${esc(c.content)}</div>
            <div style="font-size:11px;color:var(--text-muted,#9ca3af);margin-top:4px;">${Fmt.relTime(c.created_at)}</div>
          </div>
          <button class="btn btn-ghost btn-del-comment" data-cid="${c.id}" style="font-size:11px;padding:2px 8px;color:#ef4444;white-space:nowrap;">삭제</button>
        </div>`
        )
        .join('');
    }

    const body = `
      <div style="display:flex;flex-direction:column;gap:16px;">
        <div style="display:flex;align-items:center;gap:8px;">
          ${ann.is_pinned ? '<span class="badge" style="background:#fef3c7;color:#92400e;font-size:12px;padding:3px 8px;border-radius:4px;">📌 고정</span>' : ''}
          <span style="font-size:18px;font-weight:700;">${esc(ann.title)}</span>
        </div>
        <div style="font-size:12px;color:var(--text-muted,#6b7280);">
          ${esc(ann.created_by_name || '-')} · ${Fmt.date(ann.created_at)}
        </div>
        <hr style="border:none;border-top:1px solid var(--border,#e5e7eb);">
        <div id="ann-content-body" style="font-size:14px;line-height:1.7;min-height:60px;">${ann.content || ''}</div>
        <hr style="border:none;border-top:1px solid var(--border,#e5e7eb);">
        <div>
          <div style="font-size:14px;font-weight:600;margin-bottom:12px;">댓글 <span id="comment-count-badge" style="font-size:12px;color:var(--text-muted,#6b7280);">(${comments.length})</span></div>
          <div id="comment-list">${buildCommentList(comments)}</div>
          <div style="margin-top:14px;display:flex;gap:8px;align-items:flex-end;">
            <textarea id="new-comment-input" class="form-input" rows="2" placeholder="댓글을 입력하세요..." style="flex:1;resize:vertical;min-height:56px;"></textarea>
            <button class="btn btn-primary" id="btn-submit-comment" style="white-space:nowrap;height:40px;">등록</button>
          </div>
        </div>
      </div>`;

    const footer = `
      <button class="btn btn-ghost" id="ann-detail-delete-btn" style="color:#ef4444;margin-right:auto;">공지 삭제</button>
      <button class="btn btn-ghost" id="ann-detail-close-btn">닫기</button>`;

    Modal.open({ title: '공지사항 상세', body, footer, width: '680px' });

    setTimeout(() => {
      // Close
      document
        .getElementById('ann-detail-close-btn')
        .addEventListener('click', () => Modal.close());

      // Delete announcement
      document.getElementById('ann-detail-delete-btn').addEventListener('click', async () => {
        if (!confirm('이 공지사항을 삭제하시겠습니까?')) return;
        try {
          await API.del(`/board/announcements/${id}`);
          Toast.success('공지사항이 삭제되었습니다.');
          Modal.close();
          await _loadAnnouncements();
          _rerenderTab();
        } catch (_) {
          Toast.error('삭제에 실패했습니다.');
        }
      });

      // Delete comment
      document.getElementById('comment-list').addEventListener('click', async e => {
        const btn = e.target.closest('.btn-del-comment');
        if (!btn) return;
        const cid = btn.dataset.cid;
        if (!confirm('이 댓글을 삭제하시겠습니까?')) return;
        try {
          await API.del(`/board/comments/${cid}`);
          btn.closest('.comment-item').remove();
          comments = comments.filter(c => c.id !== cid);
          document.getElementById('comment-count-badge').textContent = `(${comments.length})`;
          Toast.success('댓글이 삭제되었습니다.');
        } catch (_) {
          Toast.error('삭제에 실패했습니다.');
        }
      });

      // Submit comment
      document.getElementById('btn-submit-comment').addEventListener('click', async () => {
        const content = (document.getElementById('new-comment-input').value || '').trim();
        if (!content) {
          Toast.error('댓글 내용을 입력해주세요.');
          return;
        }
        const authorName = App.team && App.team[0] ? App.team[0].name : '관리자';
        try {
          document.getElementById('btn-submit-comment').disabled = true;
          await API.post('/board/comments', {
            ref_type: 'announcement',
            ref_id: id,
            content,
            author_name: authorName,
          });
          const res2 = await API.get(`/board/comments?ref_type=announcement&ref_id=${id}`);
          comments = res2.data || [];
          document.getElementById('comment-list').innerHTML = buildCommentList(comments);
          document.getElementById('comment-count-badge').textContent = `(${comments.length})`;
          document.getElementById('new-comment-input').value = '';
          Toast.success('댓글이 등록되었습니다.');
          await _loadAnnouncements();
        } catch (_) {
          Toast.error('댓글 등록에 실패했습니다.');
        }
        document.getElementById('btn-submit-comment').disabled = false;
      });
    }, 80);
  }

  async function _loadAnnouncements() {
    try {
      const res = await API.get('/board/announcements');
      _announcements = res.data || [];
    } catch (_) {
      _announcements = [];
    }
  }

  /* ──────────────────────────────────────────────
     FAQ Tab
  ────────────────────────────────────────────── */
  const FAQ_CATEGORIES = ['영업프로세스', '제품', '시스템', '기타'];

  function _renderFAQ() {
    const grouped = _groupBy(_faqs, 'category');
    const cats = Object.keys(grouped).sort();

    return `
      <div class="card">
        <div class="card-header" style="display:flex;align-items:center;justify-content:space-between;">
          <span class="card-title">자주 묻는 질문 (FAQ)</span>
          <button class="btn btn-primary" id="btn-new-faq">+ FAQ 등록</button>
        </div>
        <div id="faq-body" style="padding:4px 0;">
          ${
            _faqs.length === 0
              ? '<p style="text-align:center;padding:40px;color:var(--text-muted,#6b7280);">등록된 FAQ가 없습니다.</p>'
              : cats
                  .map(
                    cat => `
              <div style="margin-bottom:20px;">
                <div style="font-size:13px;font-weight:700;color:var(--primary,#4f46e5);padding:8px 16px;background:var(--surface,#f3f4f6);border-radius:6px;margin-bottom:6px;letter-spacing:.5px;">
                  ${esc(cat)}
                </div>
                <div class="faq-accordion">
                  ${grouped[cat]
                    .map(
                      f => `
                    <div class="faq-item" style="border:1px solid var(--border);border-radius:8px;margin-bottom:6px;overflow:hidden;">
                      <button class="faq-q-btn faq-question-btn" data-faq-id="${f.id}"
                        style="width:100%;text-align:left;background:var(--surface);border:none;padding:14px 16px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;font-size:14px;font-weight:600;color:var(--text-1);">
                        <span>${esc(f.question)}</span>
                        <span class="faq-chevron" style="font-size:12px;color:var(--text-3);transition:transform .2s;">▼</span>
                      </button>
                      <div class="faq-answer faq-answer-area" data-faq-id="${f.id}" style="display:none;padding:12px 16px 16px;background:var(--surface-2);border-top:1px solid var(--border);font-size:14px;color:var(--text-2);line-height:1.7;white-space:pre-wrap;">${esc(f.answer)}<div style="margin-top:10px;display:flex;justify-content:flex-end;"><button class="btn btn-ghost btn-del-faq" data-id="${f.id}" style="font-size:12px;padding:3px 10px;color:#ef4444;">삭제</button></div></div>
                    </div>
                  `
                    )
                    .join('')}
                </div>
              </div>
            `
                  )
                  .join('')
          }
        </div>
      </div>`;
  }

  function _bindFAQAccordion(container) {
    container.querySelectorAll('.faq-q-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const faqId = btn.dataset.faqId;
        const answer = container.querySelector(`.faq-answer[data-faq-id="${faqId}"]`);
        const chevron = btn.querySelector('.faq-chevron');
        const isOpen = answer.style.display !== 'none';
        answer.style.display = isOpen ? 'none' : 'block';
        chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
      });
    });

    container.querySelectorAll('.btn-del-faq').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        if (!confirm('이 FAQ를 삭제하시겠습니까?')) return;
        const id = btn.dataset.id;
        try {
          await API.del(`/board/faq/${id}`);
          Toast.success('FAQ가 삭제되었습니다.');
          await _loadFAQ();
          _rerenderTab();
        } catch (_) {
          Toast.error('삭제에 실패했습니다.');
        }
      });
    });
  }

  function _openNewFAQModal() {
    const body = `
      <div style="display:flex;flex-direction:column;gap:16px;">
        <div>
          <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;">카테고리 <span style="color:#ef4444;">*</span></label>
          <select id="faq-category" class="form-input" style="width:100%;">
            ${FAQ_CATEGORIES.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;">질문 <span style="color:#ef4444;">*</span></label>
          <input id="faq-question" class="form-input" type="text" placeholder="자주 묻는 질문을 입력하세요" style="width:100%;">
        </div>
        <div>
          <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;">답변 <span style="color:#ef4444;">*</span></label>
          <textarea id="faq-answer" class="form-input" rows="5" placeholder="답변을 입력하세요..." style="width:100%;resize:vertical;"></textarea>
        </div>
      </div>`;

    const footer = `
      <button class="btn btn-ghost" id="faq-cancel-btn">취소</button>
      <button class="btn btn-primary" id="faq-save-btn">저장</button>`;

    Modal.open({ title: 'FAQ 등록', body, footer, width: '580px' });

    setTimeout(() => {
      document.getElementById('faq-cancel-btn').addEventListener('click', () => Modal.close());
      document.getElementById('faq-save-btn').addEventListener('click', async () => {
        const category = document.getElementById('faq-category').value;
        const question = (document.getElementById('faq-question').value || '').trim();
        const answer = (document.getElementById('faq-answer').value || '').trim();
        if (!question) {
          Toast.error('질문을 입력해주세요.');
          return;
        }
        if (!answer) {
          Toast.error('답변을 입력해주세요.');
          return;
        }
        try {
          document.getElementById('faq-save-btn').disabled = true;
          await API.post('/board/faq', { question, answer, category });
          Toast.success('FAQ가 등록되었습니다.');
          Modal.close();
          await _loadFAQ();
          _rerenderTab();
        } catch (_) {
          Toast.error('저장에 실패했습니다.');
          document.getElementById('faq-save-btn').disabled = false;
        }
      });
    }, 80);
  }

  async function _loadFAQ() {
    try {
      const res = await API.get('/board/faq');
      _faqs = res.data || [];
    } catch (_) {
      _faqs = [];
    }
  }

  /* ──────────────────────────────────────────────
     댓글/알림 Tab
  ────────────────────────────────────────────── */
  const REF_TYPE_LABELS = {
    announcement: '공지사항',
    lead: '리드',
    customer: '고객',
    deal: '딜',
    task: '태스크',
  };

  function _renderComments() {
    return `
      <div class="card">
        <div class="card-header">
          <span class="card-title">최근 댓글 / 알림</span>
        </div>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <thead>
              <tr style="border-bottom:1px solid var(--border,#e5e7eb);text-align:left;">
                <th style="padding:10px 12px;font-weight:600;color:var(--text-muted,#6b7280);width:100px;">유형</th>
                <th style="padding:10px 12px;font-weight:600;color:var(--text-muted,#6b7280);">내용</th>
                <th style="padding:10px 12px;font-weight:600;color:var(--text-muted,#6b7280);width:110px;">작성자</th>
                <th style="padding:10px 12px;font-weight:600;color:var(--text-muted,#6b7280);width:130px;">작성시간</th>
              </tr>
            </thead>
            <tbody>
              ${
                _recentComments.length === 0
                  ? `
                <tr><td colspan="4" style="padding:32px;text-align:center;color:var(--text-muted,#6b7280);">최근 댓글이 없습니다.</td></tr>
              `
                  : _recentComments
                      .map(
                        c => `
                <tr style="border-bottom:1px solid var(--border,#e5e7eb);">
                  <td style="padding:12px 12px;">
                    <span class="badge" style="font-size:11px;padding:2px 8px;border-radius:10px;background:var(--surface,#f3f4f6);color:var(--text-muted,#374151);">
                      ${esc(REF_TYPE_LABELS[c.ref_type] || c.ref_type || '-')}
                    </span>
                  </td>
                  <td style="padding:12px 12px;max-width:340px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${esc(c.content)}">${esc(c.content)}</td>
                  <td style="padding:12px 12px;color:var(--text-muted,#6b7280);">${esc(c.author_name || '-')}</td>
                  <td style="padding:12px 12px;color:var(--text-muted,#6b7280);font-size:12px;">${Fmt.relTime(c.created_at)}</td>
                </tr>
              `
                      )
                      .join('')
              }
            </tbody>
          </table>
        </div>
      </div>`;
  }

  async function _loadRecentComments() {
    try {
      const res = await API.get('/board/comments');
      _recentComments = res.data || [];
    } catch (_) {
      _recentComments = [];
    }
  }

  /* ──────────────────────────────────────────────
     Tab content rendering dispatcher
  ────────────────────────────────────────────── */
  function _renderTabContent() {
    switch (_activeTab) {
      case 'announcements':
        return _renderAnnouncements();
      case 'faq':
        return _renderFAQ();
      case 'comments':
        return _renderComments();
      default:
        return '';
    }
  }

  /* Re-render only the tab content area (without full page re-render) */
  function _rerenderTab() {
    const container = document.getElementById('board-tab-content');
    if (!container) return;
    container.innerHTML = _renderTabContent();
    _bindTabContent(container);
  }

  /* ──────────────────────────────────────────────
     Event binding
  ────────────────────────────────────────────── */
  function _bindTabBar(root) {
    root.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const tab = btn.dataset.tab;
        if (tab === _activeTab) return;
        _activeTab = tab;

        // Update tab button styles
        root.querySelectorAll('.tab-btn').forEach(b => {
          const active = b.dataset.tab === _activeTab;
          b.style.color = active ? 'var(--primary,#4f46e5)' : 'var(--text-muted,#6b7280)';
          b.style.borderBottom = active
            ? '2px solid var(--primary,#4f46e5)'
            : '2px solid transparent';
          b.style.fontWeight = active ? '600' : '600';
        });

        // Load data for newly active tab if needed
        if (tab === 'announcements') await _loadAnnouncements();
        if (tab === 'faq') await _loadFAQ();
        if (tab === 'comments') await _loadRecentComments();

        _rerenderTab();
      });
    });
  }

  function _bindTabContent(container) {
    switch (_activeTab) {
      case 'announcements':
        _bindAnnouncementsContent(container);
        break;
      case 'faq':
        _bindFAQContent(container);
        break;
      case 'comments':
        /* read-only */ break;
    }
  }

  function _bindAnnouncementsContent(container) {
    const newBtn = container.querySelector('#btn-new-announcement');
    if (newBtn) newBtn.addEventListener('click', _openNewAnnouncementModal);

    container.querySelectorAll('.btn-detail-ann').forEach(btn => {
      btn.addEventListener('click', () => _openAnnouncementDetail(btn.dataset.id));
    });
  }

  function _bindFAQContent(container) {
    const newBtn = container.querySelector('#btn-new-faq');
    if (newBtn) newBtn.addEventListener('click', _openNewFAQModal);
    _bindFAQAccordion(container);
  }

  /* ──────────────────────────────────────────────
     Public render()
  ────────────────────────────────────────────── */
  async function render() {
    const root = document.getElementById('content');
    if (!root) return;

    // Loading skeleton
    root.innerHTML = `
      <div style="padding:24px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
          <h1 style="font-size:22px;font-weight:700;margin:0;">커뮤니케이션 보드</h1>
        </div>
        <div style="text-align:center;padding:60px;color:var(--text-muted,#6b7280);">불러오는 중...</div>
      </div>`;

    // Load initial data (announcements tab is default)
    await _loadAnnouncements();

    root.innerHTML = `
      <div style="padding:24px;" id="board-root">
        <div style="margin-bottom:20px;">
          <h1 style="font-size:22px;font-weight:700;margin:0 0 4px;">커뮤니케이션 보드</h1>
          <p style="font-size:13px;color:var(--text-muted,#6b7280);margin:0;">공지사항, FAQ, 댓글을 관리합니다.</p>
        </div>
        ${_renderTabBar()}
        <div id="board-tab-content">
          ${_renderTabContent()}
        </div>
      </div>`;

    const boardRoot = root.querySelector('#board-root');
    _bindTabBar(boardRoot);

    const tabContent = root.querySelector('#board-tab-content');
    _bindTabContent(tabContent);
  }

  /* ──────────────────────────────────────────────
     Public API
  ────────────────────────────────────────────── */
  return { render };
})();
