const router = require('express').Router();
const pool = require('../db');
const { handleError, friendlyError } = require('../middleware/errorHandler');
const { getUserId } = require('../middleware/auth');
const { requireFeature } = require('../middleware/featureGuard');
const {
  genAI,
  MODEL_FAST,
  SAFETY_SETTINGS,
  sseStart,
  sseError,
  runStream,
  logTokenUsage,
  isUserOverLimit,
  getCrmContext,
} = require('../services/gemini');

// 챗봇 (스트리밍)
router.post('/chat', requireFeature('ai.assistant'), async (req, res) => {
  let sseStarted = false;
  try {
    const { messages, context } = req.body;
    const ctx = await getCrmContext();

    const systemPrompt = `당신은 OCI의 영업관리 AI 어시스턴트입니다.
OCI는 태양광 모듈, EPC, ESS, 전기 사업을 영위하는 회사입니다.

현재 CRM 현황:
- 활성 리드: ${ctx.stats.active_leads}건
- 입찰 진행: ${ctx.stats.bidding_count}건
- 올해 수주: ${ctx.stats.won_this_year}건 / ${Number(ctx.stats.won_amount).toFixed(1)}억원
- 진행중 프로젝트: ${ctx.stats.active_projects}건
- 등록 고객사: ${ctx.stats.total_customers}개사

최근 주요 리드:
${ctx.recentLeads.map(l => `- ${l.customer_name} | ${l.project_name} | ${l.business_type} | ${l.stage}`).join('\n')}

긴박한 입찰 일정:
${ctx.urgentLeads.map(l => `- ${l.customer_name} | ${l.project_name} | 마감: ${l.bidding_deadline}`).join('\n') || '없음'}

${context ? '추가 컨텍스트: ' + context : ''}

답변은 한국어로 명확하고 간결하게 작성하세요. 영업 실무에 도움이 되는 구체적인 조언을 제공하세요.`;

    sseStart(res);
    sseStarted = true;
    await runStream(res, {
      _userId: getUserId(req),
      model: MODEL_FAST,
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages || [{ role: 'user', content: '안녕하세요' }],
    });
  } catch (err) {
    console.error('AI chat error:', err.message);
    if (sseStarted) sseError(res, friendlyError(err));
    else res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// 고객사 브리핑
router.get('/briefing/:customerId', requireFeature('ai.intelligence'), async (req, res) => {
  let sseStarted = false;
  try {
    const [[customer]] = await pool.query('SELECT * FROM customers WHERE id = ?', [
      req.params.customerId,
    ]);
    if (!customer) return res.status(404).json({ success: false, error: '고객사 없음' });

    const [leads] = await pool.query(
      `SELECT project_name, business_type, stage, expected_amount, currency FROM leads
       WHERE customer_id = ? ORDER BY updated_at DESC LIMIT 10`,
      [req.params.customerId]
    );
    const [activities] = await pool.query(
      `SELECT a.activity_type, a.title, a.performed_at, t.name AS performer
       FROM activities a JOIN leads l ON a.lead_id = l.id
       LEFT JOIN team_members t ON a.performed_by = t.id
       WHERE l.customer_id = ? ORDER BY a.performed_at DESC LIMIT 10`,
      [req.params.customerId]
    );

    const prompt = `다음 고객사에 대한 영업 브리핑 리포트를 작성해주세요.

고객사: ${customer.name}
지역: ${customer.region} / ${customer.country || ''}
산업: ${customer.industry || '미분류'}
담당자: ${customer.contact_person || '미등록'} / ${customer.phone || ''} / ${customer.email || ''}

영업 이력 (${leads.length}건):
${leads.map(l => `- ${l.project_name} | ${l.business_type} | ${l.stage} | ${l.expected_amount}${l.currency}`).join('\n') || '없음'}

최근 활동 (${activities.length}건):
${activities.map(a => `- [${a.activity_type}] ${a.title} (${a.performer || '시스템'} / ${new Date(a.performed_at).toLocaleDateString('ko-KR')})`).join('\n') || '없음'}

다음 내용을 포함해 브리핑을 작성하세요:
1. 고객사 개요 및 특성
2. 주요 거래 현황 및 영업 단계
3. 관계 강도 평가 (활동 이력 기반)
4. 향후 영업 전략 제언 (2~3가지)
5. 주의사항 또는 리스크

간결하고 실무적으로 작성하세요.`;

    sseStart(res);
    sseStarted = true;
    await runStream(res, {
      _userId: getUserId(req),
      model: MODEL_FAST,
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (err) {
    console.error('AI briefing error:', err.message);
    if (sseStarted) sseError(res, friendlyError(err));
    else res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// 리드 히스토리 요약
router.get('/summary/:leadId', requireFeature('ai.lead_summary'), async (req, res) => {
  let sseStarted = false;
  try {
    const [[lead]] = await pool.query(
      `SELECT l.*, t.name AS assigned_name FROM leads l
       LEFT JOIN team_members t ON l.assigned_to = t.id WHERE l.id = ?`,
      [req.params.leadId]
    );
    if (!lead) return res.status(404).json({ success: false, error: '리드 없음' });

    const [activities] = await pool.query(
      `SELECT a.activity_type, a.title, a.content, a.performed_at, t.name AS performer
       FROM activities a LEFT JOIN team_members t ON a.performed_by = t.id
       WHERE a.lead_id = ? ORDER BY a.performed_at ASC`,
      [req.params.leadId]
    );

    const stageMap = {
      lead: '리드발굴',
      review: '검토',
      proposal: '제안',
      bidding: '입찰',
      negotiation: '협상',
      won: '수주',
      lost: '실주',
      dropped: '드롭',
    };

    const prompt = `다음 영업 리드의 진행 히스토리를 요약하고 분석해주세요.

프로젝트: ${lead.project_name}
고객사: ${lead.customer_name}
사업유형: ${lead.business_type} / ${lead.region}
현재 단계: ${stageMap[lead.stage] || lead.stage}
예상 금액: ${lead.expected_amount}${lead.currency}
용량: ${lead.capacity_mw ? lead.capacity_mw + ' MW' : '미정'}
담당자: ${lead.assigned_name || '미배정'}
예상 마감: ${lead.expected_close_date || '미정'}
입찰 마감: ${lead.bidding_deadline || '없음'}
메모: ${lead.notes || '없음'}

활동 이력 (${activities.length}건):
${activities.map(a => `[${new Date(a.performed_at).toLocaleDateString('ko-KR')}] ${a.activity_type}: ${a.title}${a.content ? ' - ' + a.content.substring(0, 100) : ''} (${a.performer || '시스템'})`).join('\n') || '활동 이력 없음'}

다음을 포함해 분석해주세요:
1. 영업 진행 요약 (타임라인 기반)
2. 현재 단계 평가 및 수주 가능성 (%)
3. 핵심 성공 요인 및 리스크
4. 다음 단계 액션 아이템 (구체적으로 3가지)

실무 영업 담당자가 바로 활용할 수 있게 작성하세요.`;

    sseStart(res);
    sseStarted = true;
    await runStream(res, {
      _userId: getUserId(req),
      model: MODEL_FAST,
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (err) {
    console.error('AI summary error:', err.message);
    if (sseStarted) sseError(res, friendlyError(err));
    else res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// 주간/월간 보고서 생성
router.post('/report', async (req, res) => {
  let sseStarted = false;
  try {
    const { type = 'weekly' } = req.body;
    const period = type === 'weekly' ? 7 : 30;
    const label = type === 'weekly' ? '주간' : '월간';

    const [newLeads] = await pool.query(
      `SELECT customer_name, project_name, business_type, region, expected_amount, currency, stage FROM leads WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) ORDER BY created_at DESC`,
      [period]
    );
    const [wonLeads] = await pool.query(
      `SELECT customer_name, project_name, expected_amount, currency FROM leads WHERE stage='won' AND updated_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [period]
    );
    const [activities] = await pool.query(
      `SELECT a.activity_type, a.title, l.customer_name, t.name AS performer FROM activities a LEFT JOIN leads l ON a.lead_id = l.id LEFT JOIN team_members t ON a.performed_by = t.id WHERE a.performed_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [period]
    );
    const [pipeline] = await pool.query(
      `SELECT stage, COUNT(*) AS cnt, COALESCE(SUM(expected_amount),0) AS amt FROM leads WHERE stage NOT IN ('won','lost','dropped') GROUP BY stage`
    );
    const [costChanges] = await pool.query(
      `SELECT name, category, current_price, change_pct, currency FROM products WHERE ABS(change_pct) > 2 ORDER BY ABS(change_pct) DESC LIMIT 5`
    );

    const prompt = `OCI 영업팀의 ${label} 보고서를 작성해주세요.

기간: 최근 ${period}일

## 신규 등록 리드 (${newLeads.length}건)
${newLeads.map(l => `- ${l.customer_name} | ${l.project_name} | ${l.business_type} | ${l.region} | ${l.expected_amount}${l.currency}`).join('\n') || '없음'}

## 이번 기간 수주 (${wonLeads.length}건)
${wonLeads.map(l => `- ${l.customer_name} | ${l.project_name} | ${l.expected_amount}${l.currency}`).join('\n') || '없음'}

## 영업 활동 (${activities.length}건)
${
  activities
    .slice(0, 10)
    .map(a => `- [${a.activity_type}] ${a.title} - ${a.customer_name || ''} (${a.performer || ''})`)
    .join('\n') || '없음'
}

## 현재 파이프라인
${pipeline.map(p => `- ${p.stage}: ${p.cnt}건 / ${Number(p.amt).toFixed(1)}억`).join('\n')}

## 원자재/원가 주요 변동
${costChanges.map(c => `- ${c.name}: ${c.current_price}${c.currency} (${c.change_pct > 0 ? '+' : ''}${c.change_pct}%)`).join('\n') || '없음'}

다음 형식으로 보고서를 작성하세요:
1. 📊 ${label} 영업 실적 요약
2. 🏆 주요 성과 (수주/제안)
3. 📋 파이프라인 현황 분석
4. ⚠️ 주의사항 및 리스크
5. 📈 원가/시장 동향
6. 🎯 다음 주 중점 과제 (3가지)

전문적이고 실용적인 보고서 형식으로 작성하세요.`;

    sseStart(res);
    sseStarted = true;
    await runStream(res, {
      _userId: getUserId(req),
      model: MODEL_FAST,
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (err) {
    console.error('AI report error:', err.message);
    if (sseStarted) sseError(res, friendlyError(err));
    else res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// 대시보드 인사이트 (non-streaming)
router.get('/insights', async (req, res) => {
  try {
    const ctx = await getCrmContext();
    const [riskLeads] = await pool.query(`
      SELECT customer_name, project_name, stage, expected_close_date, bidding_deadline
      FROM leads
      WHERE stage NOT IN ('won','lost','dropped')
        AND (expected_close_date <= DATE_ADD(CURRENT_DATE(), INTERVAL 14 DAY)
             OR bidding_deadline <= DATE_ADD(CURRENT_DATE(), INTERVAL 7 DAY))
      ORDER BY COALESCE(bidding_deadline, expected_close_date) ASC LIMIT 5
    `);

    const prompt = `OCI CRM 현황을 분석해 핵심 인사이트 5가지를 제공해주세요.

현황:
- 활성 리드: ${ctx.stats.active_leads}건
- 입찰 진행: ${ctx.stats.bidding_count}건
- 올해 수주: ${ctx.stats.won_this_year}건 / ${Number(ctx.stats.won_amount).toFixed(1)}억원
- 긴급 리드: ${riskLeads.map(l => `${l.customer_name}(${l.stage}, 마감:${l.bidding_deadline || l.expected_close_date})`).join(', ') || '없음'}

각 인사이트를 한 줄 요약으로 제공하세요. 형식:
[긴급/주의/정보] 인사이트 내용

영업팀이 바로 행동할 수 있는 실용적인 내용으로 작성하세요.`;

    const model = genAI.getGenerativeModel({
      model: MODEL_FAST,
      safetySettings: SAFETY_SETTINGS,
      generationConfig: {
        maxOutputTokens: 4096,
        temperature: 0.7,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    const userId = getUserId(req);
    if (await isUserOverLimit(userId)) {
      return res.status(429).json({ success: false, error: '월간 토큰 한도를 초과했습니다.' });
    }
    const result = await model.generateContent(prompt);
    await logTokenUsage('insights', result.response.usageMetadata, MODEL_FAST, userId);
    res.json({ success: true, data: result.response.text() });
  } catch (err) {
    console.error('AI insights error:', err.message);
    res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// 회의록 텍스트 요약 (레거시 — 단순 텍스트 입력)
router.post('/meeting-notes', requireFeature('ai.meeting'), async (req, res) => {
  let sseStarted = false;
  try {
    const { text, customer_name, meeting_type } = req.body;
    if (!text) return res.status(400).json({ success: false, error: '텍스트 필요' });

    const prompt = `다음 회의 내용을 정리해 구조화된 회의록으로 작성해주세요.

고객사: ${customer_name || '미기재'}
회의 유형: ${meeting_type || '영업 미팅'}
원본 텍스트:
${text}

다음 형식으로 작성하세요:
## 회의 요약
## 주요 논의 사항
## 결정 사항
## 후속 액션 아이템 (담당자 및 기한 포함)
## 다음 미팅 일정`;

    sseStart(res);
    sseStarted = true;
    await runStream(res, {
      _userId: getUserId(req),
      model: MODEL_FAST,
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (err) {
    console.error('Meeting notes error:', err.message);
    if (sseStarted) sseError(res, friendlyError(err));
    else res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// 오늘 토큰 사용량
router.get('/usage/today', async (req, res) => {
  try {
    const [[row]] = await pool.query(
      `SELECT COALESCE(SUM(total_tokens),0) AS total, COALESCE(SUM(prompt_tokens),0) AS prompt,
              COALESCE(SUM(completion_tokens),0) AS completion, COUNT(*) AS calls
       FROM ai_usage WHERE DATE(created_at) = CURRENT_DATE()`
    );
    res.json({
      success: true,
      data: {
        total: Number(row.total),
        prompt: Number(row.prompt),
        completion: Number(row.completion),
        calls: Number(row.calls),
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// 보고서 파일 내보내기 (Word / PPT)
// POST /api/ai/export  { format:'docx'|'pptx', content:'...md...', title:'...' }
// ──────────────────────────────────────────────────────────────────────────────
router.post('/export', async (req, res) => {
  try {
    const { format = 'docx', content = '', title = 'OCI 보고서' } = req.body;
    if (!content) return res.status(400).json({ success: false, error: '내용이 없습니다' });

    // ── 마크다운 파서 ────────────────────────────────────────────────────────
    function parseMarkdown(text) {
      const sections = [];
      let cur = null;
      for (const raw of text.split('\n')) {
        const line = raw.trimEnd();
        if (line.startsWith('## ')) {
          if (cur) sections.push(cur);
          cur = { title: line.slice(3).trim(), items: [] };
        } else if (line.startsWith('### ')) {
          (cur || (cur = { title: '', items: [] })).items.push({
            type: 'sub',
            text: line.slice(4).trim(),
          });
        } else if (line.startsWith('- ') || line.startsWith('• ')) {
          (cur || (cur = { title: '', items: [] })).items.push({
            type: 'bullet',
            text: line.slice(2).trim(),
          });
        } else if (/^\d+\.\s/.test(line)) {
          (cur || (cur = { title: '', items: [] })).items.push({
            type: 'num',
            text: line.replace(/^\d+\.\s/, '').trim(),
          });
        } else if (line.trim()) {
          if (!cur) cur = { title: '', items: [] };
          cur.items.push({ type: 'text', text: line.trim() });
        }
      }
      if (cur) sections.push(cur);
      return sections.filter(s => s.title || s.items.length);
    }

    // 이모지 제거 (문서 호환성)
    const stripEmoji = s =>
      s
        .replace(/[\u{1F300}-\u{1FFFF}\u{2600}-\u{27BF}]/gu, '')
        .replace(/\s{2,}/g, ' ')
        .trim();

    const now = new Date();
    const dateKo = now.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const sections = parseMarkdown(content);

    // ── WORD (.docx) ─────────────────────────────────────────────────────────
    if (format === 'docx') {
      const {
        Document,
        Paragraph,
        TextRun,
        AlignmentType,
        Packer,
        BorderStyle,
        convertInchesToTwip,
      } = require('docx');

      // 인라인 **bold** 파싱
      function inlineRuns(text, opts = {}) {
        return text
          .split(/(\*\*[^*]+\*\*)/)
          .map(part =>
            part.startsWith('**') && part.endsWith('**')
              ? new TextRun({ text: part.slice(2, -2), bold: true, ...opts })
              : new TextRun({ text: part, ...opts })
          );
      }

      const children = [
        // 표지
        new Paragraph({
          children: [new TextRun({ text: 'OCI (주)', color: '888888', size: 22 })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 80 },
        }),
        new Paragraph({
          children: [
            new TextRun({ text: stripEmoji(title), bold: true, size: 56, color: '1a73e8' }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 160 },
        }),
        new Paragraph({
          children: [new TextRun({ text: dateKo + '  생성', color: 'aaaaaa', size: 20 })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 800 },
        }),
      ];

      for (const sec of sections) {
        // 섹션 헤더
        if (sec.title) {
          children.push(
            new Paragraph({
              children: [
                new TextRun({ text: stripEmoji(sec.title), bold: true, size: 36, color: '1a73e8' }),
              ],
              spacing: { before: 500, after: 120 },
              border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'dde6fb', space: 4 } },
            })
          );
        }

        for (const item of sec.items) {
          if (item.type === 'sub') {
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: stripEmoji(item.text),
                    bold: true,
                    size: 28,
                    color: '2c5282',
                  }),
                ],
                spacing: { before: 240, after: 80 },
              })
            );
          } else if (item.type === 'bullet' || item.type === 'num') {
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: item.type === 'bullet' ? '▸  ' : '•  ',
                    color: '1a73e8',
                    bold: true,
                  }),
                  ...inlineRuns(item.text),
                ],
                indent: { left: convertInchesToTwip(0.3) },
                spacing: { after: 60 },
              })
            );
          } else {
            children.push(
              new Paragraph({
                children: inlineRuns(item.text),
                spacing: { after: 80 },
              })
            );
          }
        }
      }

      // 하단 여백
      children.push(new Paragraph({ spacing: { before: 600 } }));
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `OCI CRM AI 자동생성  |  ${dateKo}`, color: 'bbbbbb', size: 18 }),
          ],
          alignment: AlignmentType.RIGHT,
        })
      );

      const doc = new Document({
        creator: 'OCI CRM AI',
        title: stripEmoji(title),
        sections: [
          {
            properties: {
              page: {
                margin: {
                  top: convertInchesToTwip(1),
                  bottom: convertInchesToTwip(1),
                  left: convertInchesToTwip(1.2),
                  right: convertInchesToTwip(1.2),
                },
              },
            },
            children,
          },
        ],
      });

      const buffer = await Packer.toBuffer(doc);
      const filename = encodeURIComponent(stripEmoji(title).replace(/\s+/g, '_')) + '.docx';
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
      res.setHeader('Content-Length', buffer.length);
      return res.send(buffer);
    }

    // ── PPT (.pptx) ──────────────────────────────────────────────────────────
    if (format === 'pptx') {
      const pptxgen = require('pptxgenjs');
      const pptx = new pptxgen();
      pptx.layout = 'LAYOUT_WIDE'; // 33.87cm × 19.05cm
      pptx.author = 'OCI CRM AI';
      pptx.company = 'OCI';
      pptx.title = stripEmoji(title);

      const C = {
        primary: '1a73e8',
        dark: '0f1b2d',
        white: 'FFFFFF',
        text: '1a1a2e',
        muted: '6b7280',
        accent: 'e8f0fe',
      };

      // ── 표지 슬라이드 ─────────────────────────────────────────
      const cover = pptx.addSlide();
      cover.background = { color: C.dark };
      // 상단 파란 스트라이프
      cover.addShape('rect', {
        x: 0,
        y: 0,
        w: '100%',
        h: 0.18,
        fill: { color: C.primary },
        line: { type: 'none' },
      });
      // 로고 텍스트
      cover.addText('OCI (주)', {
        x: 0.6,
        y: 0.4,
        w: 4,
        h: 0.4,
        fontSize: 14,
        color: '7fafd8',
        bold: false,
      });
      // 메인 타이틀
      cover.addText(stripEmoji(title), {
        x: 0.6,
        y: 1.6,
        w: 8.8,
        h: 2.2,
        fontSize: 40,
        bold: true,
        color: C.white,
        breakLine: false,
        wrap: true,
      });
      // 날짜
      cover.addText(dateKo, { x: 0.6, y: 4.0, w: 6, h: 0.5, fontSize: 16, color: '7fafd8' });
      cover.addText('OCI CRM AI 자동생성', {
        x: 0.6,
        y: 4.6,
        w: 6,
        h: 0.4,
        fontSize: 12,
        color: C.muted,
      });
      // 하단 라인
      cover.addShape('rect', {
        x: 0,
        y: 7.32,
        w: '100%',
        h: 0.18,
        fill: { color: C.primary },
        line: { type: 'none' },
      });

      // ── 목차 슬라이드 ─────────────────────────────────────────
      if (sections.length > 1) {
        const toc = pptx.addSlide();
        toc.background = { color: C.accent };
        toc.addShape('rect', {
          x: 0,
          y: 0,
          w: '100%',
          h: 1.0,
          fill: { color: C.primary },
          line: { type: 'none' },
        });
        toc.addText('목  차', {
          x: 0.5,
          y: 0.1,
          w: '90%',
          h: 0.8,
          fontSize: 26,
          bold: true,
          color: C.white,
          valign: 'middle',
        });
        sections.forEach((sec, i) => {
          if (!sec.title) return;
          toc.addText(`${i + 1}.  ${stripEmoji(sec.title)}`, {
            x: 0.8,
            y: 1.1 + i * 0.55,
            w: '85%',
            h: 0.5,
            fontSize: 16,
            color: C.text,
          });
        });
        toc.addText(dateKo + ' | OCI CRM', {
          x: 0,
          y: 7.2,
          w: '96%',
          fontSize: 10,
          color: C.muted,
          align: 'right',
        });
      }

      // ── 내용 슬라이드 ─────────────────────────────────────────
      for (const [si, sec] of sections.entries()) {
        const slide = pptx.addSlide();
        slide.background = { color: 'FFFFFF' };

        // 상단 헤더 바
        slide.addShape('rect', {
          x: 0,
          y: 0,
          w: '100%',
          h: 1.1,
          fill: { color: C.primary },
          line: { type: 'none' },
        });
        slide.addText(sec.title ? stripEmoji(sec.title) : `섹션 ${si + 1}`, {
          x: 0.4,
          y: 0.05,
          w: '90%',
          h: 1.0,
          fontSize: 24,
          bold: true,
          color: C.white,
          valign: 'middle',
        });

        // 섹션 번호 배지
        slide.addShape('roundRect', {
          x: 9.1,
          y: 0.25,
          w: 0.5,
          h: 0.5,
          fill: { color: '3d8ef0' },
          line: { type: 'none' },
          rectRadius: 0.08,
        });
        slide.addText(String(si + 1), {
          x: 9.1,
          y: 0.25,
          w: 0.5,
          h: 0.5,
          fontSize: 14,
          bold: true,
          color: C.white,
          align: 'center',
          valign: 'middle',
        });

        let yPos = 1.25;
        const maxY = 7.0;

        for (const item of sec.items) {
          if (yPos >= maxY) break;

          if (item.type === 'sub') {
            const cleanSub = stripEmoji(item.text);
            slide.addText(cleanSub, {
              x: 0.4,
              y: yPos,
              w: '90%',
              h: 0.45,
              fontSize: 15,
              bold: true,
              color: C.primary,
            });
            yPos += 0.55;
          } else if (item.type === 'bullet' || item.type === 'num') {
            const cleanText = item.text.replace(/\*\*/g, '');
            slide.addText(
              [
                { text: '▸  ', options: { color: C.primary, bold: true } },
                { text: cleanText, options: { color: C.text } },
              ],
              {
                x: 0.55,
                y: yPos,
                w: '88%',
                h: 0.42,
                fontSize: 14,
              }
            );
            yPos += 0.5;
          } else if (item.type === 'text') {
            const cleanText = item.text.replace(/\*\*/g, '');
            slide.addText(cleanText, {
              x: 0.4,
              y: yPos,
              w: '90%',
              h: 0.4,
              fontSize: 13,
              color: C.muted,
            });
            yPos += 0.48;
          }
        }

        // 페이지 하단 구분선 (thin rect)
        slide.addShape('rect', {
          x: 0.4,
          y: 7.1,
          w: 9.2,
          h: 0.015,
          fill: { color: 'e5e7eb' },
          line: { type: 'none' },
        });
        slide.addText(`${dateKo}  |  OCI CRM AI  |  ${si + 1} / ${sections.length}`, {
          x: 0,
          y: 7.15,
          w: '96%',
          h: 0.3,
          fontSize: 9,
          color: C.muted,
          align: 'right',
        });
      }

      const buffer = await pptx.write('nodebuffer');
      const filename = encodeURIComponent(stripEmoji(title).replace(/\s+/g, '_')) + '.pptx';
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      );
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
      res.setHeader('Content-Length', buffer.length);
      return res.send(buffer);
    }

    res.status(400).json({ success: false, error: '지원하지 않는 형식입니다 (docx|pptx)' });
  } catch (err) {
    console.error('AI export error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
