import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';

export interface R2HTTPMetadata {
  contentType?: string;
  contentEncoding?: string;
  contentDisposition?: string;
  contentLanguage?: string;
  cacheControl?: string;
  cacheExpiry?: Date;
}

export interface R2Object {
  key: string;
  size: number;
  etag: string;
  httpEtag: string;
  checksums: {
    md5: string;
  };
  uploaded: Date;
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
  body: ReadableStream | null;
}

export interface R2ObjectBody extends R2Object {
  body: ReadableStream;
}

export interface R2PutOptions {
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
  md5?: string;
}

interface StoredMetadata {
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
  uploaded?: string;
  size?: number;
  etag?: string;
}

class R2ObjectImpl implements R2Object {
  key: string;
  size: number;
  etag: string;
  httpEtag: string;
  checksums: { md5: string };
  uploaded: Date;
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
  body: ReadableStream | null;

  constructor(
    key: string,
    details: {
      size: number;
      etag: string;
      body: ReadableStream | null;
      uploaded?: Date;
      httpMetadata?: R2HTTPMetadata;
      customMetadata?: Record<string, string>;
    }
  ) {
    this.key = key;
    this.size = details.size;
    this.etag = details.etag;
    this.httpEtag = `"${details.etag}"`;
    this.checksums = { md5: details.etag };
    this.uploaded = details.uploaded ?? new Date();
    this.httpMetadata = details.httpMetadata;
    this.customMetadata = details.customMetadata;
    this.body = details.body;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    if (!this.body) return new ArrayBuffer(0);
    const reader = this.body.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result.buffer as ArrayBuffer;
  }

  async text(): Promise<string> {
    const buffer = await this.arrayBuffer();
    return new TextDecoder().decode(buffer);
  }

  async json<T>(): Promise<T> {
    const text = await this.text();
    return JSON.parse(text);
  }

  async blob(): Promise<Blob> {
    const buffer = await this.arrayBuffer();
    return new Blob([buffer], {
      type: this.httpMetadata?.contentType || 'application/octet-stream',
    });
  }
}

function toNodeReadable(value: string | ArrayBuffer | ArrayBufferView | ReadableStream): Readable {
  if (typeof value === 'string') return Readable.from([Buffer.from(value, 'utf-8')]);
  if (value instanceof ReadableStream) return Readable.fromWeb(value as any);
  if (ArrayBuffer.isView(value)) {
    return Readable.from([Buffer.from(value.buffer, value.byteOffset, value.byteLength)]);
  }
  return Readable.from([Buffer.from(value)]);
}

export class FileSystemR2Adapter {
  private basePath: string;
  private metadataDir: string;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor(basePath: string) {
    this.basePath = path.resolve(basePath);
    this.metadataDir = path.join(this.basePath, '.metadata');
  }

  private async ensureDirs(): Promise<void> {
    if (this.initialized) return;

    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    this.initPromise = (async () => {
      await fs.mkdir(this.basePath, { recursive: true });
      await fs.mkdir(this.metadataDir, { recursive: true });
      this.initialized = true;
    })();

    await this.initPromise;
  }

  private sanitizeKey(key: string): string {
    // Keep `..` segments intact: validatePath below rejects escapes explicitly
    // rather than silently rewriting a traversal key into a different valid one.
    return key.replace(/^\/+/, '').replace(/\\/g, '/');
  }

  private getFilePath(key: string): string {
    const safeKey = this.sanitizeKey(key);
    return path.resolve(this.basePath, safeKey);
  }

  private getMetadataPath(key: string): string {
    const safeKey = this.sanitizeKey(key);
    const metaFileName = safeKey.replace(/\//g, '__SLASH__') + '.json';
    return path.join(this.metadataDir, metaFileName);
  }

  private validatePath(filePath: string): boolean {
    const normalized = path.resolve(filePath);
    // Ensure the resolved path is inside basePath (not a sibling like basePath-evil).
    // Using basePath + path.sep prevents /app/data/attachments-evil from matching
    // when basePath is /app/data/attachments.
    if (normalized === this.basePath) return true;
    return normalized.startsWith(this.basePath + path.sep);
  }

  private async readMetadata(metadataPath: string): Promise<StoredMetadata> {
    try {
      const raw = await fs.readFile(metadataPath, 'utf-8');
      return JSON.parse(raw) as StoredMetadata;
    } catch {
      return {};
    }
  }

  async put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView | ReadableStream,
    options?: R2PutOptions
  ): Promise<R2Object> {
    await this.ensureDirs();

    const filePath = this.getFilePath(key);

    if (!this.validatePath(filePath)) {
      throw new Error('Invalid key: path traversal detected');
    }

    const metadataPath = this.getMetadataPath(key);
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    // Stream into a temp file in the same directory, then rename. This keeps
    // large uploads out of memory and avoids exposing a partially written
    // object under the final key.
    const tempPath = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    const hash = crypto.createHash('md5');
    let size = 0;

    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        hash.update(buffer);
        callback(null, buffer);
      },
    });

    try {
      await pipeline(toNodeReadable(value), meter, fsSync.createWriteStream(tempPath));
      await fs.rename(tempPath, filePath);
    } catch (error) {
      await fs.unlink(tempPath).catch(() => undefined);
      throw error;
    }

    const etag = hash.digest('hex');
    const uploaded = new Date();
    const metadata: StoredMetadata = {
      httpMetadata: options?.httpMetadata,
      customMetadata: options?.customMetadata,
      uploaded: uploaded.toISOString(),
      size,
      etag,
    };
    await fs.writeFile(metadataPath, JSON.stringify(metadata));

    return new R2ObjectImpl(key, {
      size,
      etag,
      body: null,
      uploaded,
      httpMetadata: options?.httpMetadata,
      customMetadata: options?.customMetadata,
    });
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    const filePath = this.getFilePath(key);

    if (!this.validatePath(filePath)) {
      return null;
    }

    const metadataPath = this.getMetadataPath(key);

    try {
      const [stat, metadata] = await Promise.all([fs.stat(filePath), this.readMetadata(metadataPath)]);
      if (!stat.isFile()) return null;

      // Older objects were written before etags were persisted; derive a stable
      // fallback from the file itself.
      const etag = metadata.etag || `s${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}`;
      const body = Readable.toWeb(fsSync.createReadStream(filePath)) as unknown as ReadableStream;

      return new R2ObjectImpl(key, {
        size: stat.size,
        etag,
        body,
        uploaded: metadata.uploaded ? new Date(metadata.uploaded) : stat.mtime,
        httpMetadata: metadata.httpMetadata,
        customMetadata: metadata.customMetadata,
      }) as R2ObjectBody;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const filePath = this.getFilePath(key);
    if (!this.validatePath(filePath)) return;

    const metadataPath = this.getMetadataPath(key);

    await Promise.all([
      fs.unlink(filePath).catch((e) => {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }),
      fs.unlink(metadataPath).catch((e) => {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }),
    ]);
  }

  async list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{
    objects: R2Object[];
    truncated: boolean;
    cursor?: string;
  }> {
    await this.ensureDirs();

    const prefix = options?.prefix || '';
    const limit = options?.limit || 1000;

    const objects: R2Object[] = [];

    const scanDir = async (dir: string, prefixPath: string): Promise<void> => {
      if (objects.length >= limit) return;

      let entries: fsSync.Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (objects.length >= limit) break;
        if (entry.name === '.metadata') continue;

        const key = prefixPath ? `${prefixPath}/${entry.name}` : entry.name;
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          await scanDir(fullPath, key);
        } else {
          if (prefix && !key.startsWith(prefix)) continue;

          const stat = await fs.stat(fullPath);
          const metadata = await this.readMetadata(this.getMetadataPath(key));

          objects.push(
            new R2ObjectImpl(key, {
              size: stat.size,
              etag: metadata.etag || `s${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}`,
              body: null,
              uploaded: metadata.uploaded ? new Date(metadata.uploaded) : stat.mtime,
              httpMetadata: metadata.httpMetadata,
              customMetadata: metadata.customMetadata,
            })
          );
        }
      }
    };

    await scanDir(this.basePath, '');

    return {
      objects,
      truncated: false,
    };
  }

  async head(key: string): Promise<R2Object | null> {
    await this.ensureDirs();

    const filePath = this.getFilePath(key);
    if (!this.validatePath(filePath)) return null;

    try {
      const [stat, metadata] = await Promise.all([
        fs.stat(filePath),
        this.readMetadata(this.getMetadataPath(key)),
      ]);
      if (!stat.isFile()) return null;

      return new R2ObjectImpl(key, {
        size: stat.size,
        etag: metadata.etag || `s${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}`,
        body: null,
        uploaded: metadata.uploaded ? new Date(metadata.uploaded) : stat.mtime,
        httpMetadata: metadata.httpMetadata,
        customMetadata: metadata.customMetadata,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }
}

export function createStorageAdapter(basePath: string): FileSystemR2Adapter {
  return new FileSystemR2Adapter(basePath);
}

export type R2Bucket = FileSystemR2Adapter;
