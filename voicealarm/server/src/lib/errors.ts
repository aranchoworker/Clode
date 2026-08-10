/**
 * API 에러는 전부 { error: { code, message } } 형태로 나간다.
 * 클라이언트는 message(사람이 읽는 문구)가 아니라 code 로 분기한다.
 */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new ApiError(400, code, message, details);

export const unauthorized = (code = 'UNAUTHORIZED', message = '인증이 필요합니다.') =>
  new ApiError(401, code, message);

export const forbidden = (code: string, message: string) => new ApiError(403, code, message);

export const notFound = (code = 'NOT_FOUND', message = '대상을 찾을 수 없습니다.') =>
  new ApiError(404, code, message);

export const conflict = (code: string, message: string) => new ApiError(409, code, message);

export const tooManyRequests = (code: string, message: string, details?: unknown) =>
  new ApiError(429, code, message, details);
