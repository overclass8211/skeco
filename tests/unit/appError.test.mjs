/**
 * AppError 클래스 계층 단위 테스트
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  AppError,
  ValidationError,
  NotFoundError,
  AuthError,
  ForbiddenError,
  DatabaseError,
} = require('../../src/errors/AppError.js');

describe('AppError 기본 클래스', () => {
  it('statusCode, code, message 설정', () => {
    const err = new AppError('서버 오류', 500, 'INTERNAL_ERROR');
    expect(err.message).toBe('서버 오류');
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe('INTERNAL_ERROR');
    expect(err).toBeInstanceOf(Error);
  });

  it('name 은 클래스명', () => {
    expect(new AppError('x').name).toBe('AppError');
  });
});

describe('ValidationError', () => {
  it('statusCode 400, code VALIDATION_ERROR', () => {
    const err = new ValidationError('이름 필수', 'name');
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.field).toBe('name');
  });

  it('field 없이 생성 가능', () => {
    expect(new ValidationError('오류').field).toBeNull();
  });

  it('instanceof AppError', () => {
    expect(new ValidationError('x')).toBeInstanceOf(AppError);
  });
});

describe('NotFoundError', () => {
  it('statusCode 404, NOT_FOUND', () => {
    const err = new NotFoundError('리드');
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toContain('리드');
  });

  it('기본 메시지 사용 가능', () => {
    expect(new NotFoundError().message).toContain('리소스');
  });
});

describe('AuthError', () => {
  it('statusCode 401, UNAUTHORIZED', () => {
    const err = new AuthError();
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('UNAUTHORIZED');
  });
});

describe('ForbiddenError', () => {
  it('statusCode 403, FORBIDDEN', () => {
    const err = new ForbiddenError();
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('FORBIDDEN');
  });
});

describe('DatabaseError', () => {
  it('statusCode 500, DB_ERROR', () => {
    const err = new DatabaseError();
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe('DB_ERROR');
  });
});
