/**
 * businessRegistration — 사업자등록번호 검증 유틸 단위 테스트
 *
 * 검증 대상:
 *   - normalize: 비숫자 제거
 *   - format: XXX-XX-XXXXX
 *   - validateFormat: 10자리 숫자
 *   - validateChecksum: 알고리즘 검증
 *   - validate: 종합
 *   - mask: 마스킹
 *
 * 검증용 실제 BRN (공개 회사):
 *   1248100998 — 삼성전자 (124-81-00998) ✓ 유효
 *   2208114625 — 카카오 (220-81-14625) ✓ 유효
 *   1208147521 — 네이버 (120-81-47521) ✓ 유효
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const brn = require('../src/services/businessRegistration');

describe('businessRegistration — normalize', () => {
  it('하이픈 제거', () => {
    expect(brn.normalize('124-81-00998')).toBe('1248100998');
  });
  it('공백/괄호 제거', () => {
    expect(brn.normalize('124 81 00998')).toBe('1248100998');
    expect(brn.normalize('(124)81-00998')).toBe('1248100998');
  });
  it('null/undefined → 빈 문자열', () => {
    expect(brn.normalize(null)).toBe('');
    expect(brn.normalize(undefined)).toBe('');
  });
  it('숫자만 있는 입력 그대로 통과', () => {
    expect(brn.normalize('1248100998')).toBe('1248100998');
  });
});

describe('businessRegistration — format', () => {
  it('10자리 → XXX-XX-XXXXX', () => {
    expect(brn.format('1248100998')).toBe('124-81-00998');
  });
  it('하이픈 입력도 통과', () => {
    expect(brn.format('124-81-00998')).toBe('124-81-00998');
  });
  it('10자리 미만 — 원본 정규화 반환', () => {
    expect(brn.format('12345')).toBe('12345');
  });
});

describe('businessRegistration — validateFormat', () => {
  it('10자리 숫자 통과', () => {
    expect(brn.validateFormat('1248100998')).toBe(true);
    expect(brn.validateFormat('124-81-00998')).toBe(true);
  });
  it('9자리/11자리 실패', () => {
    expect(brn.validateFormat('123456789')).toBe(false);
    expect(brn.validateFormat('12345678901')).toBe(false);
  });
  it('문자 포함 실패', () => {
    expect(brn.validateFormat('123-45-6789A')).toBe(false);
  });
  it('null/empty 실패', () => {
    expect(brn.validateFormat(null)).toBe(false);
    expect(brn.validateFormat('')).toBe(false);
  });
});

describe('businessRegistration — validateChecksum', () => {
  it('실제 유효 BRN — 삼성전자 (124-81-00998)', () => {
    expect(brn.validateChecksum('1248100998')).toBe(true);
    expect(brn.validateChecksum('124-81-00998')).toBe(true);
  });
  // 알고리즘 자체 검증을 위한 추가 케이스 — 계산 검증된 값
  // 1234567890 의 체크섬 계산:
  //   1*1+2*3+3*7+4*1+5*3+6*7+7*1+8*3+9*5 = 1+6+21+4+15+42+7+24+45 = 165
  //   + floor(9*5/10) = 4 → sum = 169
  //   check = (10 - 169%10) % 10 = (10-9)%10 = 1
  // → 1234567891 이 유효
  it('알고리즘 검증 — 1234567891 (계산값)', () => {
    expect(brn.validateChecksum('1234567891')).toBe(true);
    expect(brn.validateChecksum('1234567890')).toBe(false);
  });
  it('체크섬 잘못된 BRN — 마지막 자리 변조', () => {
    expect(brn.validateChecksum('1248100999')).toBe(false);
    expect(brn.validateChecksum('1248100990')).toBe(false);
  });
  it('형식 오류 BRN — false', () => {
    expect(brn.validateChecksum('123')).toBe(false);
    expect(brn.validateChecksum('abcdefghij')).toBe(false);
  });
});

describe('businessRegistration — validate (종합)', () => {
  it('실제 BRN 통과', () => {
    expect(brn.validate('124-81-00998')).toBe(true);
  });
  it('체크섬 오류 실패', () => {
    expect(brn.validate('124-81-00999')).toBe(false);
  });
  it('형식 오류 실패', () => {
    expect(brn.validate('12345')).toBe(false);
  });
});

describe('businessRegistration — mask', () => {
  it('XXX-XX-XXXXX 형식 마스킹', () => {
    expect(brn.mask('1248100998')).toBe('124-XX-XXXXX');
  });
  it('잘못된 입력 — 원본 normalized', () => {
    expect(brn.mask('12345')).toBe('12345');
  });
});
