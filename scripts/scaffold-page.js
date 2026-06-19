'use strict';
// =============================================================
// scripts/scaffold-page.js — 신규 페이지 배선 자동 생성기 (Tier 2)
//
//   npm run scaffold:page -- <key> --title "매출 포캐스트" --section main \
//     [--crumb "메인 / 매출 포캐스트"] [--label "매출 포캐스트"] \
//     [--feature crm.forecast] [--roles team_lead,executive,admin] [--order 90]
//
// 7개 접점을 한 번에 안전 삽입 (각 단계 idempotent — 이미 있으면 skip):
//   1) public/js/pages/<key>.js (템플릿)         2) index.html <script>
//   3) index.html 사이드바 nav                    4) app.js pages 맵
//   5) app.js featureMap(선택)                    6) menuDefaults DEFAULT_ITEMS
//   7) authService ROLE_PAGES + eslint globals
//
// ⚠️ 런타임/DB 무변경. 생성 후 `npm run db:migrate` (메뉴 반영) + lint 권장.
// 마음에 안 들면 git restore 로 즉시 원복.
// =============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const r = p => path.join(ROOT, p);

// ── 인자 파싱 ──────────────────────────────────────────────────
const argv = process.argv.slice(2);
const key = argv[0];
const opt = {};
for (let i = 1; i < argv.length; i++) {
  if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[i + 1];
}
if (!key || !/^[a-z][a-z0-9-]*$/.test(key)) {
  console.error('❌ 사용법: npm run scaffold:page -- <key(소문자-하이픈)> --title "제목" --section main');
  process.exit(1);
}
const VALID_SECTIONS = ['main', 'erp', 'sales', 'cs', 'analysis', 'comm', 'ai'];
const section = opt.section || 'main';
if (!VALID_SECTIONS.includes(section)) {
  console.error(`❌ --section 은 ${VALID_SECTIONS.join('/')} 중 하나여야 합니다.`);
  process.exit(1);
}
const title = opt.title || key;
const crumb = opt.crumb || `${section} / ${title}`;
const label = opt.label || title;
const feature = opt.feature || '';
const roles = (opt.roles || 'team_lead,executive,admin').split(',').map(s => s.trim()).filter(Boolean);
const order = parseInt(opt.order, 10) || 90;
// key → PascalCasePage (예: report-builder → ReportBuilderPage)
const Pascal =
  key.split(/[^a-z0-9]/i).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('') + 'Page';
const qkey = /-/.test(key) ? `'${key}'` : key; // 하이픈 키는 따옴표

const changed = [];
const skipped = [];

function patch(file, mutate) {
  const fp = r(file);
  const before = fs.readFileSync(fp, 'utf8');
  const after = mutate(before);
  if (after == null || after === before) {
    skipped.push(file);
    return;
  }
  fs.writeFileSync(fp, after, 'utf8');
  changed.push(file);
}

// 1) 페이지 모듈
(() => {
  const fp = r(`public/js/pages/${key}.js`);
  if (fs.existsSync(fp)) {
    skipped.push(`public/js/pages/${key}.js`);
    return;
  }
  const tpl = `'use strict';
// =============================================================
// ${Pascal} — ${title} (scaffold 자동 생성 — 내용을 구현하세요)
// =============================================================
const ${Pascal} = {
  // API 연동 시 async 로 변경하세요 (app.js 가 await page.render() 호출)
  render() {
    document.getElementById('content').innerHTML = \`
      <div style="padding:8px 0">
        <h2 style="font-size:18px;font-weight:700;margin:0 0 12px">${title}</h2>
        <div class="card"><div style="padding:24px;color:var(--text-3)">${title} 화면 — 구현 예정</div></div>
      </div>\`;
  },
};
`;
  fs.writeFileSync(fp, tpl, 'utf8');
  changed.push(`public/js/pages/${key}.js`);
})();

// 2) index.html <script> (app.js 직전)
patch('public/index.html', c => {
  if (c.includes(`/js/pages/${key}.js`)) return null;
  return c.replace(
    '<script src="/js/app.js"></script>',
    `<script src="/js/pages/${key}.js"></script>\n<script src="/js/app.js"></script>`
  );
});

// 3) index.html 사이드바 nav (선택 섹션 타이틀 다음)
patch('public/index.html', c => {
  if (c.includes(`data-page="${key}"`)) return null;
  const lines = c.split('\n');
  const secIdx = lines.findIndex(l => l.includes(`data-section-key="${section}"`));
  if (secIdx < 0) return null;
  const titleIdx = lines.findIndex((l, i) => i > secIdx && l.includes('nav-section-title'));
  if (titleIdx < 0) return null;
  const nav =
    `      <a class="nav-item" data-page="${key}" data-action="navigate" data-menu-key="${key}"${feature ? ` data-feature="${feature}"` : ''}>\n` +
    `        <svg viewBox="0 0 20 20" fill="currentColor"><path d="M3 4h14v2H3V4zm0 5h14v2H3V9zm0 5h14v2H3v-2z"/></svg>\n` +
    `        <span>${label}</span>\n` +
    `      </a>`;
  lines.splice(titleIdx + 1, 0, nav);
  return lines.join('\n');
});

// 4) app.js pages 맵
patch('public/js/app.js', c => {
  if (new RegExp(`\\n\\s*${qkey.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}: \\{ obj:`).test(c)) return null;
  return c.replace(
    '    // @scaffold:pages',
    `    ${qkey}: { obj: () => ${Pascal}, title: '${title}', crumb: '${crumb}' },\n    // @scaffold:pages`
  );
});

// 5) app.js featureMap (선택)
if (feature) {
  patch('public/js/app.js', c => {
    if (c.includes(`${qkey}: '${feature}'`)) return null;
    return c.replace(
      '      // @scaffold:featureMap',
      `      ${qkey}: '${feature}',\n      // @scaffold:featureMap`
    );
  });
}

// 6) menuDefaults DEFAULT_ITEMS
patch('src/data/menuDefaults.js', c => {
  if (c.includes(`menu_key: '${key}'`)) return null;
  return c.replace(
    '  // @scaffold:menu-items',
    `  { menu_key: '${key}', section_key: '${section}', display_order: ${order}, is_system: 0 },\n  // @scaffold:menu-items`
  );
});

// 7a) authService ROLE_PAGES (지정 role 들)
patch('src/services/authService.js', c => {
  let out = c;
  for (const role of roles) {
    const anchor = `  ${role}: [\n`;
    if (!out.includes(anchor)) continue;
    // 해당 role 블록에 이미 키가 있으면 skip
    const blockStart = out.indexOf(anchor);
    const blockEnd = out.indexOf('],', blockStart);
    const block = out.slice(blockStart, blockEnd);
    if (block.includes(`'${key}'`)) continue;
    out = out.slice(0, blockStart + anchor.length) + `    '${key}',\n` + out.slice(blockStart + anchor.length);
  }
  return out === c ? null : out;
});

// 7b) eslint globals
patch('eslint.config.js', c => {
  if (new RegExp(`\\b${Pascal}: 'readonly'`).test(c)) return null;
  return c.replace(
    '  /* @scaffold:page-globals',
    `  ${Pascal}: 'readonly',\n  /* @scaffold:page-globals`
  );
});

// ── 요약 ──────────────────────────────────────────────────────
console.log(`\n🧩 스캐폴드: ${key} (${Pascal}) · section=${section}${feature ? ` · feature=${feature}` : ''}`);
console.log(`   roles: ${roles.join(', ')} (+superadmin)`);
if (changed.length) console.log('✅ 변경:\n   - ' + changed.join('\n   - '));
if (skipped.length) console.log('↩  skip(이미 존재):\n   - ' + skipped.join('\n   - '));
console.log('\n다음 단계:');
console.log('  1) npm run db:migrate     # 메뉴 항목 DB 반영');
console.log(`  2) public/js/pages/${key}.js 구현`);
console.log('  3) npx eslint <변경파일>   # 검증\n');
