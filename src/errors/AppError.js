class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message, field = null) {
    super(message, 400, 'VALIDATION_ERROR');
    this.field = field;
  }
}

class NotFoundError extends AppError {
  constructor(resource = '리소스') {
    super(`${resource}을(를) 찾을 수 없습니다.`, 404, 'NOT_FOUND');
  }
}

class AuthError extends AppError {
  constructor(message = '인증이 필요합니다.') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

class ForbiddenError extends AppError {
  constructor(message = '접근 권한이 없습니다.') {
    super(message, 403, 'FORBIDDEN');
  }
}

class DatabaseError extends AppError {
  constructor(message = '데이터베이스 오류가 발생했습니다.') {
    super(message, 500, 'DB_ERROR');
  }
}

module.exports = {
  AppError,
  ValidationError,
  NotFoundError,
  AuthError,
  ForbiddenError,
  DatabaseError,
};
