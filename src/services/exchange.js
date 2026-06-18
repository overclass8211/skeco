// =============================================================
// ExchangeService — 다국가 통화 → KRW 환산 (이중화 + 캐시)
//
// 우선순위:
//   1. DB 캐시 (오늘 날짜)
//   2. 한국수출입은행 매매기준율 (config.eximApiKey 있으면)
//   3. frankfurter.app (키 불필요, ECB 기반)
//   4. DB 캐시 가장 최근 값 (모든 API 실패 시)
// =============================================================
const https = require('https');
const pool = require('../db');
const config = require('../../config');

const SUPPORTED = ['USD', 'EUR', 'JPY', 'CNY', 'GBP', 'AUD', 'SGD', 'HKD', 'KRW'];

// ── 공통 fetch 헬퍼 (301/302 리다이렉트 자동 follow) ──────────
// 참고: JPY/IDR/VND 등 100단위 표기 통화는 fetchFromFrankfurter 가 자동 처리
function httpGetJson(url, timeoutMs = 8000, maxRedirect = 5) {
  return new Promise((resolve, reject) => {
    const doGet = (u, hopsLeft) => {
      const req = https.get(u, { timeout: timeoutMs }, res => {
        // 리다이렉트 처리
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && hopsLeft > 0) {
          res.resume(); // drain
          const next = res.headers.location.startsWith('http')
            ? res.headers.location
            : new URL(res.headers.location, u).toString();
          return doGet(next, hopsLeft - 1);
        }
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error('JSON 파싱 실패: ' + e.message));
            }
          } else {
            reject(new Error('HTTP ' + res.statusCode));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('timeout'));
      });
    };
    doGet(url, maxRedirect);
  });
}

// ── 1차: 수출입은행 ─────────────────────────────────────────
async function fetchFromExim(searchdate) {
  if (!config.eximApiKey) throw new Error('NO_EXIM_KEY');
  // YYYYMMDD 형식
  const yyyymmdd = searchdate.replace(/-/g, '');
  const url =
    `https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON` +
    `?authkey=${encodeURIComponent(config.eximApiKey)}&searchdate=${yyyymmdd}&data=AP01`;
  const arr = await httpGetJson(url);
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new Error('수출입은행: 응답 없음 (휴일 또는 11시 이전)');
  }
  // cur_unit 정제: "USD" / "JPY(100)" → 통화코드 + 단위배수
  const result = {};
  for (const r of arr) {
    if (r.result !== 1) continue;
    const raw = (r.cur_unit || '').trim();
    const m = raw.match(/^([A-Z]{3})(?:\((\d+)\))?$/);
    if (!m) continue;
    const code = m[1];
    const unit = m[2] ? parseInt(m[2]) : 1;
    const rate = parseFloat(String(r.deal_bas_r || '').replace(/,/g, ''));
    if (!rate || rate <= 0) continue;
    // unit이 100이면 1 단위 = rate/100
    result[code] = rate / unit;
  }
  return result; // { USD: 1365.5, EUR: 1480.3, JPY: 9.65, ... }
}

// ── 2차: frankfurter.app ────────────────────────────────────
async function fetchFromFrankfurter(targets = SUPPORTED) {
  // KRW 기준 호출 — 통화별 단일 fetch (캐시되므로 성능 OK)
  // frankfurter는 from=...&to=... 형식. 우리는 "1 USD = N KRW" 가 필요하므로
  // from=USD&to=KRW 형식으로 통화별로 호출하거나, base 변경 사용
  // 1회 호출: ?from=EUR&to=KRW 등 → 통화당 1회 = 8회
  // 더 효율적: 한 번에 from=USD&to=EUR,JPY,KRW,... 후 교차 계산
  // 간단히 통화별 단일 호출 (캐시되므로 성능 OK)
  const result = {};
  for (const code of targets) {
    if (code === 'KRW') {
      result.KRW = 1;
      continue;
    }
    try {
      const url = `https://api.frankfurter.app/latest?from=${code}&to=KRW`;
      const j = await httpGetJson(url, 6000);
      const rate = j?.rates?.KRW;
      if (rate && rate > 0) result[code] = rate;
    } catch (e) {
      // 개별 통화 실패는 무시 (다른 통화는 계속 처리)
      console.warn(`[FX] frankfurter ${code} 실패:`, e.message);
    }
  }
  if (Object.keys(result).length === 0) throw new Error('frankfurter: 모든 통화 실패');
  return result;
}

// ── DB 캐시 조회 ────────────────────────────────────────────
async function getFromCache(currency, date = null) {
  if (currency === 'KRW') return 1;
  if (date) {
    const [[r]] = await pool.query(
      `SELECT rate_to_krw FROM exchange_rates
       WHERE currency_code=? AND rate_date=? LIMIT 1`,
      [currency, date]
    );
    if (r) return Number(r.rate_to_krw);
  }
  // date 없으면 최신
  const [[r2]] = await pool.query(
    `SELECT rate_to_krw, rate_date FROM exchange_rates
     WHERE currency_code=? ORDER BY rate_date DESC LIMIT 1`,
    [currency]
  );
  return r2 ? Number(r2.rate_to_krw) : null;
}

// ── DB upsert ───────────────────────────────────────────────
async function saveRates(rates, source, dateStr = null) {
  const today = dateStr || new Date().toISOString().slice(0, 10);
  for (const [code, rate] of Object.entries(rates)) {
    if (!rate || rate <= 0) continue;
    await pool.query(
      `INSERT INTO exchange_rates (currency_code, rate_to_krw, source, rate_date)
       VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE rate_to_krw=VALUES(rate_to_krw), source=VALUES(source), fetched_at=NOW()`,
      [code, rate, source, today]
    );
  }
}

// ── 공개 API ────────────────────────────────────────────────

/**
 * 단일 통화 환율 조회 (KRW 환산)
 * @param {string} currency  통화 코드 (USD, EUR, JPY, KRW...)
 * @param {string} [date]    'YYYY-MM-DD' (생략 시 오늘)
 * @returns {number}  1 단위 = N KRW
 */
async function getRate(currency, date = null) {
  const cur = String(currency || 'KRW').toUpperCase();
  if (cur === 'KRW') return 1;

  // 특정 날짜 조회는 캐시 only (과거 환율은 변동 없음)
  if (date) {
    const cached = await getFromCache(cur, date);
    if (cached) return cached;
    // 과거 날짜 캐시 미스 → 최신값으로 폴백
    const latest = await getFromCache(cur, null);
    if (latest) return latest;
    throw new Error(`${cur} 환율 없음 (캐시 부재)`);
  }

  // 오늘 — 캐시 먼저, 없으면 갱신 시도
  const today = new Date().toISOString().slice(0, 10);
  const todayCached = await getFromCache(cur, today);
  if (todayCached) return todayCached;

  // API 호출 → DB 갱신
  await refreshAll().catch(e => console.warn('[FX] refreshAll 실패:', e.message));
  const refreshed = await getFromCache(cur, today);
  if (refreshed) return refreshed;

  // 최후: 캐시 가장 최근값
  const latest = await getFromCache(cur, null);
  if (latest) return latest;
  throw new Error(`${cur} 환율 조회 실패`);
}

/**
 * 금액 → KRW 환산
 */
async function convertToKrw(amount, currency, date = null) {
  const amt = Number(amount || 0);
  if (!amt) return 0;
  const rate = await getRate(currency, date);
  return Math.round(amt * rate);
}

/**
 * 전체 통화 일괄 갱신 (이중화: 수출입은행 → frankfurter)
 */
async function refreshAll() {
  let rates = null;
  let source = null;

  // Primary: 수출입은행 (오늘 데이터, 휴일이면 어제부터 거슬러 시도)
  if (config.eximApiKey) {
    for (let back = 0; back < 5; back++) {
      const d = new Date();
      d.setDate(d.getDate() - back);
      const dateStr = d.toISOString().slice(0, 10);
      try {
        const r = await fetchFromExim(dateStr);
        if (Object.keys(r).length) {
          rates = r;
          source = 'exim';
          console.log(`[FX] 수출입은행 ${dateStr} 환율 ${Object.keys(r).length}건 수신`);
          await saveRates(rates, source, dateStr);
          break;
        }
      } catch (e) {
        console.warn(`[FX] 수출입은행 ${dateStr} 실패:`, e.message);
      }
    }
  }

  // Fallback: frankfurter
  if (!rates) {
    try {
      rates = await fetchFromFrankfurter();
      source = 'frankfurter';
      console.log(`[FX] frankfurter 환율 ${Object.keys(rates).length}건 수신`);
      await saveRates(rates, source);
    } catch (e) {
      console.error('[FX] frankfurter 실패:', e.message);
    }
  }

  if (!rates) throw new Error('모든 환율 API 실패 — DB 캐시 사용');
  return { source, rates };
}

/**
 * 최신 환율 표 (UI용)
 */
async function getAllLatest() {
  const [rows] = await pool.query(`
    SELECT er.currency_code, er.rate_to_krw, er.source, er.rate_date, er.fetched_at
    FROM exchange_rates er
    INNER JOIN (
      SELECT currency_code, MAX(rate_date) AS max_date
      FROM exchange_rates GROUP BY currency_code
    ) latest ON er.currency_code = latest.currency_code AND er.rate_date = latest.max_date
    ORDER BY er.currency_code`);
  return rows;
}

module.exports = {
  SUPPORTED,
  getRate,
  convertToKrw,
  refreshAll,
  getAllLatest,
  saveRates, // 수동 등록용
};
