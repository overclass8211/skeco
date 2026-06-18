// =============================================================
// DB 스키마 문서 다운로드 — DOCS (Word) 생성
// 경로: GET /api/admin/dev/schema/export/docx
// =============================================================
const router = require('express').Router();
const pool = require('../db');
const { handleError } = require('../middleware/errorHandler');
const {
  Document,
  Packer,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  TextRun,
  HeadingLevel,
  AlignmentType,
  WidthType,
  PageBreak,
  ShadingType,
  Footer,
  Header,
  PageNumber,
} = require('docx');

// devOnly 가드
function devOnly(req, res, next) {
  if (req.user?.role !== 'superadmin')
    return res.status(403).json({ success: false, error: 'superadmin 전용' });
  next();
}

// ── 한글 컬럼 매핑 (간이) ────────────────────────────────────
const TABLE_KO = {
  leads: '영업 리드',
  customers: '고객사',
  activities: '활동 이력',
  projects: '프로젝트',
  team_members: '팀 멤버',
  calendar_events: '캘린더',
  meeting_minutes: '회의록',
  products: '제품/원가',
  cost_history: '원가 이력',
  announcements: '공지사항',
  announcement_views: '공지 열람',
  comments: '댓글',
  faq: 'FAQ',
  users: '사용자',
  refresh_tokens: 'Refresh 토큰',
  token_blacklist: '블랙리스트',
  ai_usage: 'AI 사용량',
  token_recharge_log: '토큰 충전',
  dev_features: '기능 플래그',
  system_settings: '시스템 설정',
  access_logs: '접근 로그',
  google_oauth_tokens: 'Google OAuth',
  google_meet_sessions: 'Google Meet',
  pipeline_stages: '파이프라인 단계',
  exchange_rates: '환율 시계열',
  customer_briefs: '고객 AI 브리핑',
  schema_change_log: '스키마 변경 이력',
  _migrations: '마이그레이션 마커',
};

// ── 색상 헬퍼 ─────────────────────────────────────────────
const COLOR = {
  primary: '1664E5',
  accent: '7C4DFF',
  text: '111827',
  textLight: '6B7280',
  bgLight: 'F3F4F6',
  border: 'E5E7EB',
  red: 'E63329',
  green: '17A85A',
  orange: 'F59C00',
};

// ── Cell 생성 헬퍼 ────────────────────────────────────────
const cell = (text, opts = {}) =>
  new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.bg ? { type: ShadingType.CLEAR, color: 'auto', fill: opts.bg } : undefined,
    children: [
      new Paragraph({
        alignment: opts.center ? AlignmentType.CENTER : AlignmentType.LEFT,
        children: [
          new TextRun({
            text: String(text ?? ''),
            bold: opts.bold,
            size: opts.size || 18,
            color: opts.color || COLOR.text,
            font: 'Malgun Gothic',
          }),
        ],
      }),
    ],
  });

// 표지 페이지 생성
function buildCoverPage() {
  const today = new Date();
  const ymd = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`;

  return [
    new Paragraph({ children: [new TextRun({ text: '', size: 24 })] }),
    new Paragraph({ children: [new TextRun({ text: '', size: 24 })] }),
    new Paragraph({ children: [new TextRun({ text: '', size: 24 })] }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: '🔥 핑거세일즈 AI',
          bold: true,
          size: 72,
          color: COLOR.primary,
          font: 'Malgun Gothic',
        }),
      ],
    }),
    new Paragraph({ children: [new TextRun({ text: '', size: 24 })] }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: 'DB 테이블 정의서',
          bold: true,
          size: 60,
          color: COLOR.text,
          font: 'Malgun Gothic',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: 'Database Schema Definition Document',
          size: 28,
          color: COLOR.textLight,
          italics: true,
          font: 'Malgun Gothic',
        }),
      ],
    }),
    new Paragraph({ children: [new TextRun({ text: '', size: 24 })] }),
    new Paragraph({ children: [new TextRun({ text: '', size: 24 })] }),
    new Paragraph({ children: [new TextRun({ text: '', size: 24 })] }),
    new Paragraph({ children: [new TextRun({ text: '', size: 24 })] }),
    new Paragraph({ children: [new TextRun({ text: '', size: 24 })] }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: `발행일: ${ymd}`,
          size: 24,
          color: COLOR.textLight,
          font: 'Malgun Gothic',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: 'Confidential · For Internal Use Only',
          size: 20,
          color: COLOR.textLight,
          font: 'Malgun Gothic',
        }),
      ],
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

// 목차 페이지
function buildToc(tables) {
  const rows = [
    new TableRow({
      tableHeader: true,
      children: [
        cell('#', { bold: true, center: true, bg: COLOR.primary, color: 'FFFFFF', size: 20 }),
        cell('테이블', { bold: true, bg: COLOR.primary, color: 'FFFFFF', size: 20 }),
        cell('한글명', { bold: true, bg: COLOR.primary, color: 'FFFFFF', size: 20 }),
        cell('컬럼수', { bold: true, center: true, bg: COLOR.primary, color: 'FFFFFF', size: 20 }),
        cell('행수', { bold: true, center: true, bg: COLOR.primary, color: 'FFFFFF', size: 20 }),
      ],
    }),
  ];
  tables.forEach((t, i) => {
    rows.push(
      new TableRow({
        children: [
          cell(String(i + 1), { center: true, size: 18 }),
          cell(t.name, { size: 18, bold: true }),
          cell(TABLE_KO[t.name] || '—', { size: 18, color: COLOR.textLight }),
          cell(String(t.colCount), { center: true, size: 18 }),
          cell(String(t.rowCount || 0), { center: true, size: 18, color: COLOR.textLight }),
        ],
      })
    );
  });

  return [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [
        new TextRun({
          text: '📋 목차',
          bold: true,
          size: 36,
          color: COLOR.primary,
          font: 'Malgun Gothic',
        }),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `총 ${tables.length}개 테이블`,
          size: 22,
          color: COLOR.textLight,
          font: 'Malgun Gothic',
        }),
      ],
    }),
    new Paragraph({ children: [new TextRun({ text: '', size: 12 })] }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows,
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

// 각 테이블 상세 페이지
function buildTablePage(table, fks) {
  const fksOut = fks.filter(f => f.TABLE_NAME === table.name);
  const fksIn = fks.filter(f => f.REFERENCED_TABLE_NAME === table.name);

  const parts = [];
  // 제목
  parts.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [
        new TextRun({
          text: `📂 ${table.name}`,
          bold: true,
          size: 32,
          color: COLOR.primary,
          font: 'Malgun Gothic',
        }),
        new TextRun({
          text: `   ${TABLE_KO[table.name] || ''}`,
          size: 24,
          color: COLOR.textLight,
          font: 'Malgun Gothic',
        }),
      ],
    })
  );

  // 요약 라인
  parts.push(
    new Paragraph({
      spacing: { before: 100, after: 200 },
      children: [
        new TextRun({
          text: `컬럼 ${table.colCount}개  ·  데이터 ${table.rowCount || 0}건  ·  FK 출 ${fksOut.length} / FK 입 ${fksIn.length}`,
          size: 20,
          color: COLOR.textLight,
          font: 'Malgun Gothic',
        }),
      ],
    })
  );

  // 컬럼 표
  const colRows = [
    new TableRow({
      tableHeader: true,
      children: [
        cell('#', { bold: true, center: true, bg: COLOR.primary, color: 'FFFFFF', size: 18 }),
        cell('컬럼명', { bold: true, bg: COLOR.primary, color: 'FFFFFF', size: 18 }),
        cell('타입', { bold: true, bg: COLOR.primary, color: 'FFFFFF', size: 18 }),
        cell('NULL', { bold: true, center: true, bg: COLOR.primary, color: 'FFFFFF', size: 18 }),
        cell('기본값', { bold: true, bg: COLOR.primary, color: 'FFFFFF', size: 18 }),
        cell('키/인덱스', { bold: true, bg: COLOR.primary, color: 'FFFFFF', size: 18 }),
        cell('설명', { bold: true, bg: COLOR.primary, color: 'FFFFFF', size: 18 }),
      ],
    }),
  ];

  table.columns.forEach((c, i) => {
    const keyDesc =
      c.COLUMN_KEY === 'PRI'
        ? 'PK'
        : c.COLUMN_KEY === 'UNI'
          ? 'UNIQUE'
          : c.COLUMN_KEY === 'MUL'
            ? 'INDEX'
            : '—';
    const keyColor =
      c.COLUMN_KEY === 'PRI'
        ? COLOR.primary
        : c.COLUMN_KEY === 'UNI'
          ? COLOR.accent
          : COLOR.textLight;
    colRows.push(
      new TableRow({
        children: [
          cell(String(i + 1), { center: true, size: 16, color: COLOR.textLight }),
          cell(c.COLUMN_NAME, { size: 16, bold: true }),
          cell(c.COLUMN_TYPE, { size: 14, color: COLOR.textLight }),
          cell(c.IS_NULLABLE === 'YES' ? 'YES' : 'NO', {
            center: true,
            size: 14,
            color: c.IS_NULLABLE === 'NO' ? COLOR.red : COLOR.orange,
          }),
          cell(
            c.COLUMN_DEFAULT === null || c.COLUMN_DEFAULT === undefined
              ? '—'
              : String(c.COLUMN_DEFAULT),
            { size: 14, color: COLOR.textLight }
          ),
          cell(keyDesc, { center: true, size: 14, color: keyColor, bold: keyDesc !== '—' }),
          cell(c.COLUMN_COMMENT || '—', { size: 14, color: COLOR.textLight }),
        ],
      })
    );
  });

  parts.push(
    new Paragraph({
      children: [
        new TextRun({
          text: '📊 컬럼 정의',
          bold: true,
          size: 24,
          color: COLOR.text,
          font: 'Malgun Gothic',
        }),
      ],
      spacing: { before: 200, after: 100 },
    })
  );
  parts.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: colRows }));

  // FK 관계 표 (있을 경우만)
  if (fksOut.length > 0) {
    parts.push(
      new Paragraph({
        children: [
          new TextRun({
            text: '🔗 FK 출 (이 테이블이 참조하는 외부 테이블)',
            bold: true,
            size: 22,
            color: COLOR.text,
            font: 'Malgun Gothic',
          }),
        ],
        spacing: { before: 300, after: 100 },
      })
    );
    const fkOutRows = [
      new TableRow({
        tableHeader: true,
        children: [
          cell('컬럼', { bold: true, bg: COLOR.accent, color: 'FFFFFF', size: 16 }),
          cell('참조 테이블', { bold: true, bg: COLOR.accent, color: 'FFFFFF', size: 16 }),
          cell('참조 컬럼', { bold: true, bg: COLOR.accent, color: 'FFFFFF', size: 16 }),
          cell('ON DELETE', { bold: true, bg: COLOR.accent, color: 'FFFFFF', size: 16 }),
        ],
      }),
      ...fksOut.map(
        f =>
          new TableRow({
            children: [
              cell(f.COLUMN_NAME, { size: 14, bold: true }),
              cell(f.REFERENCED_TABLE_NAME, { size: 14 }),
              cell(f.REFERENCED_COLUMN_NAME, { size: 14, color: COLOR.textLight }),
              cell(f.DELETE_RULE || 'RESTRICT', { size: 14, color: COLOR.textLight }),
            ],
          })
      ),
    ];
    parts.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: fkOutRows }));
  }

  if (fksIn.length > 0) {
    parts.push(
      new Paragraph({
        children: [
          new TextRun({
            text: '🔗 FK 입 (이 테이블을 참조하는 외부 테이블)',
            bold: true,
            size: 22,
            color: COLOR.text,
            font: 'Malgun Gothic',
          }),
        ],
        spacing: { before: 300, after: 100 },
      })
    );
    const fkInRows = [
      new TableRow({
        tableHeader: true,
        children: [
          cell('자식 테이블', { bold: true, bg: COLOR.green, color: 'FFFFFF', size: 16 }),
          cell('자식 컬럼', { bold: true, bg: COLOR.green, color: 'FFFFFF', size: 16 }),
        ],
      }),
      ...fksIn.map(
        f =>
          new TableRow({
            children: [
              cell(f.TABLE_NAME, { size: 14, bold: true }),
              cell(f.COLUMN_NAME, { size: 14, color: COLOR.textLight }),
            ],
          })
      ),
    ];
    parts.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: fkInRows }));
  }

  parts.push(new Paragraph({ children: [new PageBreak()] }));
  return parts;
}

// ── DOCS 생성 엔드포인트 ──────────────────────────────────
router.get('/export/docx', devOnly, async (req, res) => {
  try {
    const [[db]] = await pool.query('SELECT DATABASE() AS d');
    const dbName = db.d;

    // 모든 테이블 + 컬럼 + 통계
    const [tablesRaw] = await pool.query(
      `SELECT TABLE_NAME, TABLE_ROWS FROM information_schema.TABLES
       WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME`,
      [dbName]
    );
    const [allCols] = await pool.query(
      `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT,
              COLUMN_KEY, COLUMN_COMMENT, ORDINAL_POSITION
       FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=?
       ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      [dbName]
    );
    const [allFks] = await pool.query(
      `SELECT k.TABLE_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME,
              r.DELETE_RULE
       FROM information_schema.KEY_COLUMN_USAGE k
       LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS r
         ON r.CONSTRAINT_NAME=k.CONSTRAINT_NAME AND r.CONSTRAINT_SCHEMA=k.TABLE_SCHEMA
       WHERE k.TABLE_SCHEMA=? AND k.REFERENCED_TABLE_NAME IS NOT NULL`,
      [dbName]
    );

    const colsByTable = {};
    allCols.forEach(c => (colsByTable[c.TABLE_NAME] = colsByTable[c.TABLE_NAME] || []).push(c));

    const tables = tablesRaw.map(t => ({
      name: t.TABLE_NAME,
      rowCount: t.TABLE_ROWS,
      columns: colsByTable[t.TABLE_NAME] || [],
      colCount: (colsByTable[t.TABLE_NAME] || []).length,
    }));

    // 문서 빌드
    const doc = new Document({
      creator: '핑거세일즈 AI',
      title: '핑거세일즈 AI DB 테이블 정의서',
      description: 'DB 스키마 정의서',
      sections: [
        {
          headers: {
            default: new Header({
              children: [
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  children: [
                    new TextRun({
                      text: '핑거세일즈 AI · DB 테이블 정의서',
                      size: 14,
                      color: COLOR.textLight,
                      font: 'Malgun Gothic',
                    }),
                  ],
                }),
              ],
            }),
          },
          footers: {
            default: new Footer({
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({
                      text: '- ',
                      size: 14,
                      color: COLOR.textLight,
                      font: 'Malgun Gothic',
                    }),
                    new TextRun({
                      children: [PageNumber.CURRENT],
                      size: 14,
                      color: COLOR.textLight,
                    }),
                    new TextRun({
                      text: ' / ',
                      size: 14,
                      color: COLOR.textLight,
                      font: 'Malgun Gothic',
                    }),
                    new TextRun({
                      children: [PageNumber.TOTAL_PAGES],
                      size: 14,
                      color: COLOR.textLight,
                    }),
                    new TextRun({
                      text: ' -',
                      size: 14,
                      color: COLOR.textLight,
                      font: 'Malgun Gothic',
                    }),
                  ],
                }),
              ],
            }),
          },
          children: [
            ...buildCoverPage(),
            ...buildToc(tables),
            ...tables.flatMap(t => buildTablePage(t, allFks)),
          ],
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    const filename = `핑거세일즈_AI_DB_테이블_정의서_${new Date().toISOString().slice(0, 10)}.docx`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    res.send(buffer);
  } catch (e) {
    console.error('DOCS export error:', e);
    handleError(res, e);
  }
});

module.exports = router;
