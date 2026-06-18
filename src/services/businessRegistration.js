// ============================================================
// businessRegistration — 사업자등록번호(BRN) 검증/정규화 유틸 (v6.0.0)
//
// 한국 사업자등록번호: 10자리 숫자, 표시 형식 XXX-XX-XXXXX
// 마지막 자리는 체크섬 (가중치 1,3,7,1,3,7,1,3,5 + 5번째 자리 * 5 → mod 10)
//
// 책임:
//   - normalize(brn)         : 비숫자 제거 → 10자리 숫자 문자열
//   - format(brn)            : 표시용 XXX-XX-XXXXX
//   - validateFormat(brn)    : 10자리 숫자인지
//   - validateChecksum(brn)  : 체크섬 알고리즘 검증
//   - validate(brn)          : 형식 + 체크섬 모두 통과
//   - mask(brn)              : 마지막 5자리 마스킹 (선택)
// ============================================================
'use strict';

/**
 * 입력값을 10자리 숫자 문자열로 정규화
 * @param {string|null|undefined} brn
 * @returns {string} '' if invalid input
 */
function normalize(brn) {
  if (brn === null || brn === undefined) return '';
  return String(brn).replace(/[^0-9]/g, '');
}

/**
 * 표시용 포맷 XXX-XX-XXXXX
 * @param {string} brn
 * @returns {string}
 */
function format(brn) {
  const n = normalize(brn);
  if (n.length !== 10) return n; // 잘못된 입력 — 원본 normalized 반환
  return `${n.slice(0, 3)}-${n.slice(3, 5)}-${n.slice(5)}`;
}

/**
 * 형식 검증 — 정규화 후 정확히 10자리 숫자인지
 * @param {string} brn
 * @returns {boolean}
 */
function validateFormat(brn) {
  const n = normalize(brn);
  return /^[0-9]{10}$/.test(n);
}

/**
 * 체크섬 알고리즘 검증
 *
 * 알고리즘 (국세청 사업자등록번호 검증):
 *   - 가중치: [1,3,7,1,3,7,1,3,5]
 *   - 1~9번째 자리에 가중치 곱해 합산
 *   - 9번째 자리는 5를 더 곱한 후 floor(/10)도 합산 (자리 올림)
 *   - 합산 % 10 의 보수 (10 - 합산%10) % 10 == 마지막 자리
 *
 * @param {string} brn
 * @returns {boolean}
 */
function validateChecksum(brn) {
  const n = normalize(brn);
  if (!/^[0-9]{10}$/.test(n)) return false;

  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += Number(n[i]) * weights[i];
  }
  // 9번째 자리(인덱스 8) × 5의 자리 올림 보정
  sum += Math.floor((Number(n[8]) * 5) / 10);

  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === Number(n[9]);
}

/**
 * 종합 검증 (형식 + 체크섬)
 * @param {string} brn
 * @returns {boolean}
 */
function validate(brn) {
  return validateFormat(brn) && validateChecksum(brn);
}

/**
 * 마스킹 — 처음 3자리만 노출, 나머지 ***
 * 예: 123-XX-XXXXX
 * @param {string} brn
 * @returns {string}
 */
function mask(brn) {
  const n = normalize(brn);
  if (n.length !== 10) return n;
  return `${n.slice(0, 3)}-XX-XXXXX`;
}

module.exports = {
  normalize,
  format,
  validateFormat,
  validateChecksum,
  validate,
  mask,
};
