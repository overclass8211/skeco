// =============================================================
// 모듈 간 고객사 연동 (트랙 2: 누락 회사 등록 + 전 모듈 customer_id 백필)
//
//   node mock-data/link-customers.js                  # 리포트(등록 후보 + 연결 건수) — 쓰기 없음
//   node mock-data/link-customers.js --create         # 백업 → 고객사 생성 → 전 모듈 백필 → 검증
//   node mock-data/link-customers.js --create --exclude="대전,(임시)"  # 특정 후보 제외
//
// 원칙(= db-mutation-safety): 가산만(INSERT/UPDATE NULL행), 파괴적 SQL 없음, 트랜잭션,
//   생성 전 customers 백업, dedup 으로 중복 고객사 방지.
// =============================================================
const fs = require('fs');
const path = require('path');
const pool = require('../src/db');

// 고객사명 정규화 (src/routes/customers.js normalizeCompanyName 와 동일 규칙 + 매칭용 소문자/무공백)
function norm(name) {
  if (!name) return '';
  let s = String(name).trim();
  s = s.replace(/[(〔（]\s*(주식회사|유한회사|재단법인|사단법인|주|유)\s*[)〕）]/gi, '');
  s = s.replace(/㈜|㈕|㈐|㉾/g, '');
  s = s.replace(/(주식회사|유한회사|재단법인|사단법인)\s*/gi, '');
  s = s.replace(
    /\s*[,.]?\s*(Inc\.?|Co\.?|Ltd\.?|Corp\.?|LLC|GmbH|S\.A\.?|Limited|Corporation|Company)\b\.?/gi,
    ''
  );
  return s.replace(/\s+/g, ' ').trim();
}
// dedup 키: 정규화 + 소문자 + 모든 공백 제거 (변형 통합: "NICE 피앤아이"≈"NICE피앤아이")
const keyOf = name => norm(name).toLowerCase().replace(/\s+/g, '');

// 비회사명/플레이스홀더 — 기본 제외 추천
const SUSPECT = /^(\(임시\)|임시|미정|테스트|test|대전|샘플|샘플고객|n\/a|na|-)$/i;
// 합성 테스트 패턴 — 절대 고객사로 생성 금지 (cleanse 전 실행돼도 안전; 순서 의존 제거)
const JUNK = /^(Bulk__TEST__|__TEST__|테스트[0-9]|테스트고객)/;

const NAME_TABLES = ['leads', 'contracts', 'proposals', 'quotes', 'payment_schedules', 'tax_invoices', 'projects'];

async function main() {
  const create = process.argv.includes('--create');
  const exArg = (process.argv.find(a => a.startsWith('--exclude=')) || '').replace('--exclude=', '');
  const userExclude = new Set(exArg ? exArg.split(',').map(s => s.trim()).filter(Boolean) : []);
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  // 1) 기존 고객사 정규화 맵
  const [cust] = await pool.query('SELECT id,name FROM customers');
  const custKey = new Map(); // key → id
  for (const c of cust) if (!custKey.has(keyOf(c.name))) custKey.set(keyOf(c.name), c.id);

  // 2) 모듈에서 customer_id NULL & 이름 보유 → 후보 수집(그룹화)
  const groups = new Map(); // key → { variants:Map(raw→cnt), rowsByTable:{} }
  for (const t of NAME_TABLES) {
    const [rows] = await pool.query(
      `SELECT customer_name nm, COUNT(*) c FROM \`${t}\`
        WHERE customer_id IS NULL AND customer_name IS NOT NULL AND customer_name<>''
        GROUP BY customer_name`
    );
    for (const r of rows) {
      const k = keyOf(r.nm);
      if (!k) continue;
      if (custKey.has(k)) continue; // 이미 고객사 존재 → 생성 대상 아님(백필로 연결)
      if (!groups.has(k)) groups.set(k, { variants: new Map(), rows: {} });
      const g = groups.get(k);
      g.variants.set(r.nm, (g.variants.get(r.nm) || 0) + r.c);
      g.rows[t] = (g.rows[t] || 0) + r.c;
    }
  }

  // 3) 후보 정리: canonical = 최빈 변형(동률 시 최장)
  const candidates = [];
  for (const [k, g] of groups) {
    const variants = [...g.variants.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
    const canonical = variants[0][0];
    const total = Object.values(g.rows).reduce((a, b) => a + b, 0);
    const suspect = SUSPECT.test(canonical.trim()) || JUNK.test(canonical.trim()) || userExclude.has(canonical);
    candidates.push({ key: k, canonical, variants: variants.map(v => v[0]), rows: g.rows, total, suspect });
  }
  candidates.sort((a, b) => b.total - a.total);

  const willCreate = candidates.filter(c => !c.suspect);
  const skipped = candidates.filter(c => c.suspect);

  console.log(`=== 등록 후보 (고객사 미존재 회사) — 총 ${candidates.length}개 ===`);
  console.log('  [canonical] 연결될행수 (모듈별)  | 변형');
  for (const c of willCreate) {
    const mods = Object.entries(c.rows).map(([t, n]) => `${t}:${n}`).join(' ');
    const vary = c.variants.length > 1 ? `  | 변형: ${c.variants.join(', ')}` : '';
    console.log(`  ✔ ${c.canonical}  →  ${c.total}행 (${mods})${vary}`);
  }
  if (skipped.length) {
    console.log(`\n=== 제외 추천(비회사명/플레이스홀더) — ${skipped.length}개 ===`);
    for (const c of skipped) console.log(`  ✘ ${c.canonical}  (${c.total}행) — --exclude 기본 제외`);
  }
  console.log(`\n요약: 등록 ${willCreate.length}개 → 연결 ${willCreate.reduce((a, c) => a + c.total, 0)}행 / 제외 ${skipped.length}개`);

  if (!create) {
    console.log('\n💡 리포트 모드 — 생성 안 함. 실제 등록+백필: --create');
    process.exit(0);
  }

  // 4) 백업(customers 전량) → 생성 → 전 모듈 백필 (트랜잭션)
  const [allCust] = await pool.query('SELECT * FROM customers');
  const file = path.join(__dirname, `backup-customers-${ts}.json`);
  fs.writeFileSync(file, JSON.stringify({ generatedAt: ts, customers: allCust }, null, 0), 'utf8');
  console.log(`\n✅ customers 백업: ${file}`);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // 4a) 고객사 생성 (가산) — 생성 직후 id 회수
    const created = [];
    for (const c of willCreate) {
      const [r] = await conn.query(
        `INSERT INTO customers (name, created_at) VALUES (?, NOW())`,
        [c.canonical]
      );
      created.push({ id: r.insertId, key: c.key, name: c.canonical });
    }
    // 4b) 전 모듈 customer_id 백필 — canonical + 모든 변형 이름으로 매칭
    const keyToId = new Map(created.map(x => [x.key, x.id]));
    // 기존 고객사도 포함(정확/정규화 매칭) → 누락 없이 전체 연결
    for (const c of cust) if (!keyToId.has(keyOf(c.name))) keyToId.set(keyOf(c.name), c.id);

    const backfill = {};
    for (const t of NAME_TABLES) {
      const [rows] = await conn.query(
        `SELECT id, customer_name FROM \`${t}\`
          WHERE customer_id IS NULL AND customer_name IS NOT NULL AND customer_name<>''`
      );
      let n = 0;
      for (const row of rows) {
        const id = keyToId.get(keyOf(row.customer_name));
        if (!id) continue;
        await conn.query(`UPDATE \`${t}\` SET customer_id=? WHERE id=?`, [id, row.id]);
        n++;
      }
      backfill[t] = n;
    }
    await conn.commit();
    console.log(`\n✅ 고객사 생성: ${created.length}개`);
    console.log('✅ 모듈별 customer_id 백필:');
    for (const t of NAME_TABLES) console.log(`  ${t}: +${backfill[t]}`);
  } catch (e) {
    await conn.rollback();
    console.error('\n❌ 오류 — 전체 롤백:', e.message);
    process.exit(1);
  } finally {
    conn.release();
  }
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
