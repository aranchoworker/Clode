import { createWriteStream } from 'node:fs';
import { mkdir, copyFile, rm, stat } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createStorageToken } from '../../lib/signing.js';
import type { SignedUrl, StorageAdapter, UploadUrlOptions } from './types.js';

/**
 * 개발용 로컬 디스크 어댑터.
 *
 * 업로드/다운로드 URL 은 이 서버의 /storage/* 엔드포인트를 가리키고, S3 presigned URL 과
 * 동일하게 서명·만료를 갖는다. 나중에 S3 어댑터로 갈아끼워도 클라이언트 코드는 그대로다.
 */
export class LocalDiskStorage implements StorageAdapter {
  constructor(
    private readonly rootDir: string,
    private readonly publicBaseUrl: string,
  ) {}

  /**
   * 키를 실제 경로로 바꾼다.
   *
   * `../` 가 섞인 키가 들어오면 루트 밖 파일을 읽고 쓸 수 있으므로 반드시 막는다.
   * 키는 서버가 만들지만, 클라이언트가 POST /voice-messages 로 되돌려 주는 값이라
   * "우리가 만든 값"이라고 가정하면 안 된다.
   */
  private pathFor(key: string): string {
    const root = resolve(this.rootDir);
    const target = resolve(root, normalize(key));
    if (target !== root && !target.startsWith(root + sep)) {
      throw new Error(`잘못된 스토리지 키: ${key}`);
    }
    return target;
  }

  async createUploadUrl(key: string, options: UploadUrlOptions): Promise<SignedUrl> {
    const expiresAt = new Date(Date.now() + options.expiresInSec * 1000);
    const token = createStorageToken({
      key,
      purpose: 'up',
      exp: Math.floor(expiresAt.getTime() / 1000),
      max: options.maxBytes,
    });

    const url = new URL('/storage/upload', this.publicBaseUrl);
    url.searchParams.set('key', key);
    url.searchParams.set('token', token);

    return {
      url: url.toString(),
      method: 'PUT',
      headers: { 'content-type': options.contentType },
      expiresAt,
    };
  }

  async createDownloadUrl(key: string, expiresInSec: number): Promise<SignedUrl> {
    const expiresAt = new Date(Date.now() + expiresInSec * 1000);
    const token = createStorageToken({
      key,
      purpose: 'dn',
      exp: Math.floor(expiresAt.getTime() / 1000),
    });

    const url = new URL('/storage/download', this.publicBaseUrl);
    url.searchParams.set('key', key);
    url.searchParams.set('token', token);

    return { url: url.toString(), method: 'GET', headers: {}, expiresAt };
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.pathFor(key));
      return true;
    } catch {
      return false;
    }
  }

  async size(key: string): Promise<number> {
    return (await stat(this.pathFor(key))).size;
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  /** 로컬 어댑터에서는 이미 파일이 디스크에 있으므로 복사 없이 경로만 준다. */
  async materialize(key: string): Promise<{ path: string; dispose: () => Promise<void> }> {
    return { path: this.pathFor(key), dispose: async () => undefined };
  }

  async putFile(key: string, localPath: string): Promise<void> {
    const target = this.pathFor(key);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(localPath, target);
  }

  /**
   * /storage/upload 핸들러가 쓰는 실제 저장.
   * 인터페이스에는 없다 — S3 어댑터에서는 서버를 거치지 않기 때문이다.
   */
  async writeStream(key: string, stream: Readable, maxBytes: number): Promise<number> {
    const target = this.pathFor(key);
    await mkdir(dirname(target), { recursive: true });

    let written = 0;
    let exceeded = false;

    // 다 받고 나서 크기를 재면 이미 디스크를 다 쓴 뒤다. 흘러가는 중에 끊는다.
    stream.on('data', (chunk: Buffer) => {
      written += chunk.length;
      if (written > maxBytes && !exceeded) {
        exceeded = true;
        stream.destroy(new Error('UPLOAD_TOO_LARGE'));
      }
    });

    try {
      await pipeline(stream, createWriteStream(target));
    } catch (error) {
      await rm(target, { force: true });
      if (exceeded) throw new Error('UPLOAD_TOO_LARGE');
      throw error;
    }

    return written;
  }

  /** 다운로드 핸들러가 쓰는 경로 조회. */
  resolveReadPath(key: string): string {
    return this.pathFor(key);
  }

  static keyJoin(...parts: string[]): string {
    return join(...parts).split(sep).join('/');
  }
}
