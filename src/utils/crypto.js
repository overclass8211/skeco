'use strict';
/**
 * AES-256-GCM 암호화/복호화 유틸리티
 * 사용처: OTP secret, Google OAuth token 등 민감 데이터 DB 저장 시
 *
 * 형식: <iv_hex>:<authTag_hex>:<ciphertext_hex>
 */
const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12; // GCM 권장 96-bit IV
// TAG_BYTES = 16 (GCM 표준) — getAuthTag() 가 자동으로 16바이트 반환

function _getKey() {
  const hex = process.env.ENCRYPTION_KEY || '';
  if (hex.length !== 64) {
    throw new Error('ENCRYPTION_KEY 환경변수가 32바이트(64자 hex)여야 합니다.');
  }
  return Buffer.from(hex, 'hex');
}

/**
 * 평문 문자열을 암호화하여 저장 가능한 문자열 반환
 * @param {string} plaintext
 * @returns {string}  "iv:tag:ciphertext" (hex 구분)
 */
function encrypt(plaintext) {
  if (plaintext === null || plaintext === undefined) return null;
  const key = _getKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

/**
 * 암호화된 문자열을 복호화
 * @param {string} stored  "iv:tag:ciphertext"
 * @returns {string}
 */
function decrypt(stored) {
  if (stored === null || stored === undefined) return null;
  // 암호화되지 않은 기존 데이터(레거시) 그대로 반환
  if (!stored.includes(':')) return stored;
  const parts = stored.split(':');
  if (parts.length !== 3) return stored;
  const [ivHex, tagHex, cipherHex] = parts;
  try {
    const key = _getKey();
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const cipher_ = Buffer.from(cipherHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(cipher_), decipher.final()]).toString('utf8');
  } catch (_) {
    // 복호화 실패 시 원문 반환 (마이그레이션 기간 대비)
    return stored;
  }
}

/** 값이 이미 암호화되어 있는지 확인 */
function isEncrypted(value) {
  if (!value || typeof value !== 'string') return false;
  const parts = value.split(':');
  return (
    parts.length === 3 &&
    /^[0-9a-f]{24}$/.test(parts[0]) && // 12바이트 IV = 24hex
    /^[0-9a-f]{32}$/.test(parts[1])
  ); // 16바이트 tag = 32hex
}

module.exports = { encrypt, decrypt, isEncrypted };
