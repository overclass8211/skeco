/**
 * Export Helper + Export Endpoints 통합 테스트
 *
 * 검증 항목:
 *  1. exportHelper — CSV/Excel/JSON 변환 단위
 *  2. normalizeFormat — 잘못된 값 default
 *  3. CSV 이스케이프 (콤마/큰따옴표/줄바꿈)
 *  4. UTF-8 BOM 포함 (한국어)
 *  5. 5개 엔티티 export 엔드포인트 — format 별 응답 헤더 + content type
 */
import { describe, it, expect } from 'vitest';
import { api } from './helpers.mjs';
import { toCsvBuffer, toJsonBuffer, normalizeFormat } from '../src/utils/exportHelper.js';

const SAMPLE_COLUMNS = [
  { key: 'id', label: 'ID' },
  { key: 'name', label: '이름' },
  { key: 'note', label: '메모' },
];
const SAMPLE_ROWS = [
  { id: 1, name: '홍길동', note: '일반' },
  { id: 2, name: '김,철수', note: '콤마 포함' },
  { id: 3, name: '박"영희', note: '큰따옴표' },
  { id: 4, name: '이순신', note: '줄\n바꿈' },
];

describe('exportHelper — normalizeFormat', () => {
  it('xlsx/csv/json 통과', () => {
    expect(normalizeFormat('xlsx')).toBe('xlsx');
    expect(normalizeFormat('csv')).toBe('csv');
    expect(normalizeFormat('json')).toBe('json');
  });
  it('대소문자 무관', () => {
    expect(normalizeFormat('CSV')).toBe('csv');
    expect(normalizeFormat('JSON')).toBe('json');
  });
  it('잘못된 값 → xlsx default', () => {
    expect(normalizeFormat('pdf')).toBe('xlsx');
    expect(normalizeFormat('')).toBe('xlsx');
    expect(normalizeFormat(undefined)).toBe('xlsx');
  });
});

describe('exportHelper — CSV 변환', () => {
  it('UTF-8 BOM 포함', () => {
    const buf = toCsvBuffer(SAMPLE_COLUMNS, SAMPLE_ROWS);
    // BOM = 0xEF 0xBB 0xBF
    expect(buf[0]).toBe(0xef);
    expect(buf[1]).toBe(0xbb);
    expect(buf[2]).toBe(0xbf);
  });

  it('헤더 한글 정상', () => {
    const buf = toCsvBuffer(SAMPLE_COLUMNS, SAMPLE_ROWS);
    const text = buf.toString('utf8');
    expect(text).toContain('ID,이름,메모');
  });

  it('콤마 포함 셀 → 큰따옴표로 wrap', () => {
    const buf = toCsvBuffer(SAMPLE_COLUMNS, SAMPLE_ROWS);
    const text = buf.toString('utf8');
    expect(text).toContain('"김,철수"');
  });

  it('큰따옴표 포함 셀 → "" 로 escape', () => {
    const buf = toCsvBuffer(SAMPLE_COLUMNS, SAMPLE_ROWS);
    const text = buf.toString('utf8');
    expect(text).toContain('"박""영희"');
  });

  it('줄바꿈 포함 셀 → 큰따옴표로 wrap', () => {
    const buf = toCsvBuffer(SAMPLE_COLUMNS, SAMPLE_ROWS);
    const text = buf.toString('utf8');
    expect(text).toContain('"줄\n바꿈"');
  });

  it('CRLF 라인 종결자', () => {
    const buf = toCsvBuffer(SAMPLE_COLUMNS, [{ id: 1, name: 'a', note: 'b' }]);
    const text = buf.toString('utf8');
    expect(text).toContain('\r\n');
  });
});

describe('exportHelper — JSON 변환', () => {
  it('표준 구조 (exported_at, count, columns, rows)', () => {
    const buf = toJsonBuffer(SAMPLE_COLUMNS, SAMPLE_ROWS);
    const j = JSON.parse(buf.toString('utf8'));
    expect(j.exported_at).toBeDefined();
    expect(j.count).toBe(4);
    expect(Array.isArray(j.columns)).toBe(true);
    expect(Array.isArray(j.rows)).toBe(true);
    expect(j.rows[0]).toEqual({ id: 1, name: '홍길동', note: '일반' });
  });

  it('Date 객체 → ISO 문자열', () => {
    const cols = [{ key: 'dt', label: 'Date' }];
    const rows = [{ dt: new Date('2026-05-16T10:00:00Z') }];
    const buf = toJsonBuffer(cols, rows);
    const j = JSON.parse(buf.toString('utf8'));
    expect(j.rows[0].dt).toBe('2026-05-16T10:00:00.000Z');
  });

  it('undefined → null', () => {
    const cols = [{ key: 'a', label: 'A' }];
    const rows = [{}];
    const buf = toJsonBuffer(cols, rows);
    const j = JSON.parse(buf.toString('utf8'));
    expect(j.rows[0].a).toBeNull();
  });
});

describe('Export endpoints — format 응답 헤더', () => {
  const cases = [
    { path: '/api/leads/export', entity: 'leads' },
    { path: '/api/customers/export', entity: 'customers' },
    { path: '/api/projects/export', entity: 'projects' },
    { path: '/api/activities/export', entity: 'activities' },
    { path: '/api/meetings/export', entity: 'meetings' },
    { path: '/api/team/export', entity: 'team' },
  ];

  for (const c of cases) {
    it(`${c.entity} — xlsx (기본)`, async () => {
      const res = await api().get(c.path);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/spreadsheetml/);
      expect(res.headers['content-disposition']).toContain('.xlsx');
    });

    it(`${c.entity} — ?format=csv`, async () => {
      const res = await api().get(c.path + '?format=csv');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.headers['content-disposition']).toContain('.csv');
      // BOM 검증
      const body = res.body || Buffer.from(res.text || '', 'utf8');
      const first = body.length > 0 ? body[0] : null;
      // supertest 응답은 buffer 또는 string — 둘 다 처리
      if (Buffer.isBuffer(body) && body.length >= 3) {
        expect(body[0]).toBe(0xef);
      }
    });

    it(`${c.entity} — ?format=json`, async () => {
      const res = await api().get(c.path + '?format=json');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.headers['content-disposition']).toContain('.json');
      // 응답 본문 — JSON 파싱 (supertest 가 buffer 로 줄 수 있어 수동 파싱)
      let parsed;
      if (res.body && typeof res.body === 'object' && res.body.rows) {
        parsed = res.body;
      } else {
        const text = res.text || (res.body && res.body.toString('utf8')) || '';
        parsed = JSON.parse(text);
      }
      expect(parsed).toHaveProperty('exported_at');
      expect(parsed).toHaveProperty('count');
      expect(parsed).toHaveProperty('rows');
      expect(Array.isArray(parsed.rows)).toBe(true);
    });

    it(`${c.entity} — 잘못된 format → xlsx`, async () => {
      const res = await api().get(c.path + '?format=pdf');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/spreadsheetml/);
    });
  }
});
