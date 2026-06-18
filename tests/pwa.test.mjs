/**
 * PWA 자원 정적 서빙 + 캐시 헤더 회귀 테스트
 */
import { describe, it, expect } from 'vitest';
import { api } from './helpers.mjs';

describe('PWA 자원 서빙', () => {
  it('GET /manifest.json — 200 + JSON + PWA 필수 필드', async () => {
    const res = await api().get('/manifest.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body.name).toBe('OCI CRM AI');
    expect(res.body.short_name).toBe('OCI CRM');
    expect(res.body.start_url).toBe('/');
    expect(res.body.display).toBe('standalone');
    expect(res.body.theme_color).toBe('#E63329');
    expect(Array.isArray(res.body.icons)).toBe(true);
    expect(res.body.icons.length).toBeGreaterThanOrEqual(2);
    // 캐시 헤더 — 짧은 캐시
    expect(res.headers['cache-control']).toMatch(/max-age=3600/);
  });

  it('GET /sw.js — 200 + JS + no-cache', async () => {
    const res = await api().get('/sw.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.headers['cache-control']).toMatch(/no-cache/);
    expect(res.text).toContain("addEventListener('install'");
    expect(res.text).toContain("addEventListener('fetch'");
  });

  it('GET /offline.html — 200 + HTML 오프라인 fallback', async () => {
    const res = await api().get('/offline.html');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toContain('오프라인입니다');
  });

  it('GET /assets/pwa-icon.svg — 200 + SVG', async () => {
    const res = await api()
      .get('/assets/pwa-icon.svg')
      .buffer(true)
      .parse((res, cb) => {
        let data = '';
        res.on('data', chunk => {
          data += chunk;
        });
        res.on('end', () => cb(null, data));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/svg/);
    expect(res.body).toContain('<svg');
  });

  it('GET / — index.html 에 PWA 메타 포함', async () => {
    const res = await api().get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('rel="manifest"');
    expect(res.text).toContain('theme-color');
    expect(res.text).toContain("serviceWorker.register('/sw.js')");
  });
});
