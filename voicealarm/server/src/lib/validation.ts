import { z } from 'zod';
import { badRequest } from './errors.js';

/** zod 스키마로 파싱하고, 실패하면 400 VALIDATION_ERROR 로 통일해서 던진다. */
export function parseOrThrow<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw badRequest(
      'VALIDATION_ERROR',
      '요청 값이 올바르지 않습니다.',
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
  return result.data;
}

/**
 * 로그인 아이디 규칙: 영문/숫자/._- 3~20자.
 * 저장·조회는 항상 소문자로 정규화한다. 대소문자만 다른 아이디를 서로 다른 계정으로
 * 허용하면 사칭(admin / Admin)이 쉬워진다.
 */
export const userIdSchema = z
  .string()
  .trim()
  .min(3, '아이디는 3자 이상이어야 합니다.')
  .max(20, '아이디는 20자 이하여야 합니다.')
  .regex(/^[a-zA-Z0-9._-]+$/, '아이디는 영문, 숫자, . _ - 만 사용할 수 있습니다.')
  .transform((value) => value.toLowerCase());

export const passwordSchema = z
  .string()
  .min(8, '비밀번호는 8자 이상이어야 합니다.')
  .max(128, '비밀번호는 128자 이하여야 합니다.');

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, '표시 이름을 입력해 주세요.')
  .max(30, '표시 이름은 30자 이하여야 합니다.');

export const uuidSchema = z.string().uuid('올바른 ID 형식이 아닙니다.');
