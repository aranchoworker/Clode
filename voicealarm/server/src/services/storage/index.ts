import { resolve } from 'node:path';
import { env } from '../../config/env.js';
import { LocalDiskStorage } from './localDisk.js';
import type { StorageAdapter } from './types.js';

export type { StorageAdapter, SignedUrl, UploadUrlOptions } from './types.js';
export { LocalDiskStorage } from './localDisk.js';

/**
 * 드라이버 선택. 지금은 로컬뿐이지만, S3 를 추가할 때 바뀌는 곳은 여기 하나다.
 * (config/env.ts 의 STORAGE_DRIVER 에 's3' 를 추가하고 여기서 분기하면 된다.)
 */
export function createStorage(): StorageAdapter {
  switch (env().STORAGE_DRIVER) {
    case 'local':
      return new LocalDiskStorage(resolve(env().STORAGE_LOCAL_DIR), env().PUBLIC_BASE_URL);
  }
}
