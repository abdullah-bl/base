/**
 * Pluggable storage backend for file uploads.
 *
 * Download returns a union because S3 redirect mode yields a presigned URL
 * (302) rather than a body stream.
 */
export type DownloadResult =
  | { kind: 'stream'; body: ReadableStream<Uint8Array> | Uint8Array }
  | { kind: 'redirect'; url: string }

export interface StorageDriver {
  readonly name: 'local' | 's3'
  put(
    key: string,
    data: Uint8Array,
    mimeType: string,
  ): Promise<{ size: number }>
  download(key: string, mimeType: string): Promise<DownloadResult | null>
  delete(key: string): Promise<boolean>
  exists(key: string): Promise<boolean>
}
