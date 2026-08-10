/**
 * 오브젝트 스토리지 경계.
 *
 * 개발은 로컬 디스크로 시작하고 운영은 S3 호환 스토리지로 간다. 그래서 라우트 코드가
 * 파일 경로를 절대 직접 다루지 않게 인터페이스를 먼저 고정한다.
 * S3 어댑터를 붙일 때 바뀌는 건 이 인터페이스의 구현체 하나뿐이다.
 */

export type SignedUrl = {
  url: string;
  method: 'PUT' | 'GET';
  headers: Record<string, string>;
  expiresAt: Date;
};

export type UploadUrlOptions = {
  contentType: string;
  maxBytes: number;
  expiresInSec: number;
};

export interface StorageAdapter {
  /** 클라이언트가 직접 업로드할 수 있는 URL. 서버를 거치지 않는다(S3 기준). */
  createUploadUrl(key: string, options: UploadUrlOptions): Promise<SignedUrl>;

  /** 만료 시간이 있는 다운로드 URL. */
  createDownloadUrl(key: string, expiresInSec: number): Promise<SignedUrl>;

  exists(key: string): Promise<boolean>;
  size(key: string): Promise<number>;
  delete(key: string): Promise<void>;

  /**
   * ffmpeg 에 넘길 수 있는 로컬 파일 경로를 확보한다.
   *
   * S3 어댑터에서는 임시 디렉터리로 내려받은 뒤 경로를 준다. 그래서 호출부는
   * 반드시 dispose() 를 불러 임시 파일을 정리해야 한다.
   */
  materialize(key: string): Promise<{ path: string; dispose: () => Promise<void> }>;

  /** 서버가 만든 파일(트랜스코딩 결과)을 올린다. */
  putFile(key: string, localPath: string, contentType: string): Promise<void>;
}
