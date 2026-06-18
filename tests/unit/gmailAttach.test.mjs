/**
 * gmail.js _buildRawMessageWithAttachments 단위 테스트 — Phase 5-A
 *
 * Gmail API 호출 없이 raw 메시지 구조만 검증:
 *   - multipart/mixed boundary 헤더
 *   - 본문 part (text/plain + base64)
 *   - 첨부 part (Content-Disposition + RFC2047 인코딩된 한글 파일명)
 *   - boundary 종료 마커 (--BOUNDARY--)
 *   - base64url 인코딩 (= 제거, +/_ → -/_)
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { _buildRawMessageWithAttachments } = require('../../src/services/gmail.js');

// base64url → utf8 디코딩 헬퍼 (검증용)
function decodeBase64Url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  // padding 복원
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

describe('Phase 5-A: _buildRawMessageWithAttachments', () => {
  it('첨부 없으면 multipart 의 본문 part 만 포함 + boundary 종료', () => {
    const raw = _buildRawMessageWithAttachments({
      from: 'me@oci.com',
      to: 'client@example.com',
      subject: '안녕하세요',
      body: '본문 텍스트',
      attachments: [],
    });
    const decoded = decodeBase64Url(raw);
    expect(decoded).toContain('From: me@oci.com');
    expect(decoded).toContain('To: client@example.com');
    expect(decoded).toContain('Content-Type: multipart/mixed; boundary="');
    // 한글 제목은 RFC 2047 인코딩
    expect(decoded).toContain('Subject: =?UTF-8?B?');
    // 본문 part
    expect(decoded).toContain('Content-Type: text/plain; charset=UTF-8');
    expect(decoded).toContain('Content-Transfer-Encoding: base64');
    // 종료 마커 — boundary 추출 후 검증
    const m = decoded.match(/boundary="([^"]+)"/);
    expect(m).not.toBeNull();
    const boundary = m[1];
    expect(decoded).toContain(`--${boundary}--`);
    // 본문 base64 디코딩 가능
    const bodyMatch = decoded.match(/base64\r?\n\r?\n([A-Za-z0-9+/=]+)/);
    expect(bodyMatch).not.toBeNull();
    expect(Buffer.from(bodyMatch[1], 'base64').toString('utf8')).toBe('본문 텍스트');
  });

  it('첨부 1개 — Content-Disposition + 한글 파일명 RFC2047 인코딩', () => {
    const fileData = Buffer.from('%PDF-1.4 test file');
    const raw = _buildRawMessageWithAttachments({
      from: 'me@oci.com',
      to: 'client@example.com',
      subject: 'RFP 응답',
      body: '안녕하세요',
      attachments: [
        {
          filename: '제안서_v1.pdf',
          mimeType: 'application/pdf',
          data: fileData,
        },
      ],
    });
    const decoded = decodeBase64Url(raw);
    expect(decoded).toContain('Content-Disposition: attachment; filename="=?UTF-8?B?');
    expect(decoded).toContain('Content-Type: application/pdf; name="=?UTF-8?B?');
    // 한글 파일명 RFC 2047 디코딩 가능
    const fnameMatch = decoded.match(/filename="=\?UTF-8\?B\?([^?]+)\?="/);
    expect(fnameMatch).not.toBeNull();
    expect(Buffer.from(fnameMatch[1], 'base64').toString('utf8')).toBe('제안서_v1.pdf');
    // 첨부 데이터 base64 인코딩 포함 확인
    const expectedB64 = fileData.toString('base64');
    expect(decoded).toContain(expectedB64.slice(0, 20));
  });

  it('첨부 여러 개 — boundary 가 부속 + 모든 파일 포함', () => {
    const raw = _buildRawMessageWithAttachments({
      from: 'a@a.com',
      to: 'b@b.com',
      subject: 'multi',
      body: '본문',
      attachments: [
        { filename: 'a.pdf', mimeType: 'application/pdf', data: Buffer.from('AAA') },
        { filename: 'b.png', mimeType: 'image/png', data: Buffer.from('BBB') },
        { filename: 'c.txt', mimeType: 'text/plain', data: Buffer.from('CCC') },
      ],
    });
    const decoded = decodeBase64Url(raw);
    // 본문 boundary + 3개 첨부 boundary + 종료 — boundary 출현 5회
    const m = decoded.match(/boundary="([^"]+)"/);
    const b = m[1];
    const occurrences = (decoded.match(new RegExp(`--${b.replace(/[+]/g, '\\+')}`, 'g')) || [])
      .length;
    // 본문 part 시작 + 첨부 3 시작 + 종료 마커 = 5
    expect(occurrences).toBe(5);
    // 각 파일 데이터 포함
    expect(decoded).toContain(Buffer.from('AAA').toString('base64'));
    expect(decoded).toContain(Buffer.from('BBB').toString('base64'));
    expect(decoded).toContain(Buffer.from('CCC').toString('base64'));
  });

  it('base64url 인코딩 — = padding 제거 + +,/ → -,_ 치환', () => {
    const raw = _buildRawMessageWithAttachments({
      from: 'a@a.com',
      to: 'b@b.com',
      subject: 'x',
      body: 'x',
    });
    // base64url 은 '=' 가 없고 '+', '/' 가 없어야 함
    expect(raw).not.toMatch(/=/);
    expect(raw).not.toMatch(/\+/);
    expect(raw).not.toMatch(/\//);
    // 유효 문자만 (A-Z, a-z, 0-9, -, _)
    expect(raw).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it('cc / bcc 헤더 — 명시한 경우만 포함', () => {
    const raw = _buildRawMessageWithAttachments({
      from: 'a@a.com',
      to: 'b@b.com',
      cc: 'c@c.com',
      bcc: 'd@d.com',
      subject: 'cc/bcc',
      body: 'x',
    });
    const decoded = decodeBase64Url(raw);
    expect(decoded).toContain('Cc: c@c.com');
    expect(decoded).toContain('Bcc: d@d.com');
  });

  it('cc/bcc 없으면 헤더에 미포함', () => {
    const raw = _buildRawMessageWithAttachments({
      from: 'a@a.com',
      to: 'b@b.com',
      subject: 'no cc',
      body: 'x',
    });
    const decoded = decodeBase64Url(raw);
    expect(decoded).not.toContain('Cc:');
    expect(decoded).not.toContain('Bcc:');
  });

  it('빈/잘못된 attachment 항목은 무시 (filename 또는 data 누락)', () => {
    const raw = _buildRawMessageWithAttachments({
      from: 'a@a.com',
      to: 'b@b.com',
      subject: 'skip',
      body: 'x',
      attachments: [
        { filename: null, mimeType: 'application/pdf', data: Buffer.from('A') },
        { filename: 'ok.pdf', mimeType: 'application/pdf', data: null },
        { filename: 'good.pdf', mimeType: 'application/pdf', data: Buffer.from('GOOD') },
      ],
    });
    const decoded = decodeBase64Url(raw);
    // 유효한 1건만 포함
    expect(decoded).toContain('good.pdf'.replace(/./g, '')); // 인코딩되므로 base64 로 검증
    const goodFnameB64 = Buffer.from('good.pdf', 'utf8').toString('base64');
    expect(decoded).toContain(goodFnameB64);
    expect(decoded).toContain(Buffer.from('GOOD').toString('base64'));
    // 잘못된 2건은 첨부 헤더 미포함 — boundary 출현 횟수: 본문 1 + 첨부 1 + 종료 1 = 3
    const m = decoded.match(/boundary="([^"]+)"/);
    const occurrences = (
      decoded.match(new RegExp(`--${m[1].replace(/[+]/g, '\\+')}`, 'g')) || []
    ).length;
    expect(occurrences).toBe(3);
  });
});
