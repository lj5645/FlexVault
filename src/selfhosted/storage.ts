import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';

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

class R2ObjectImpl implements R2ObjectBody {
  key: string;
  size: number;
  etag: string;
  httpEtag: string;
  checksums: { md5: string };
  uploaded: Date;
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
  body: ReadableStream;

  constructor(
    key: string,
    data: Buffer,
    metadata?: {
      httpMetadata?: R2HTTPMetadata;
      customMetadata?: Record<string, string>;
      uploaded?: Date;
    }
  ) {
    this.key = key;
    this.size = data.length;
    this.etag = this.computeEtag(data);
    this.httpEtag = `"${this.etag}"`;
    this.checksums = { md5: this.etag };
    this.uploaded = metadata?.uploaded ?? new Date();
    this.httpMetadata = metadata?.httpMetadata;
    this.customMetadata = metadata?.customMetadata;
    this.body = this.bufferToReadableStream(data);
  }

  private computeEtag(data: Buffer): string {
    return crypto.createHash('md5').update(data).digest('hex');
  }

  private bufferToReadableStream(buffer: Buffer): ReadableStream {
    return new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(buffer));
        controller.close();
      },
    });
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
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
    let sanitized = key.replace(/\.\./g, '');
    sanitized = sanitized.replace(/^\/+/, '');
    sanitized = sanitized.replace(/\\/g, '/');
    return sanitized;
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
    return normalized.startsWith(this.basePath);
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

    let buffer: Buffer;
    if (typeof value === 'string') {
      buffer = Buffer.from(value, 'utf-8');
    } else if (value instanceof ReadableStream) {
      buffer = await this.readableStreamToBuffer(value);
    } else if (ArrayBuffer.isView(value)) {
      buffer = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    } else if (value instanceof ArrayBuffer) {
      buffer = Buffer.from(value);
    } else {
      buffer = Buffer.from(value as ArrayBuffer);
    }

    await fs.writeFile(filePath, buffer);

    const metadata = {
      httpMetadata: options?.httpMetadata,
      customMetadata: options?.customMetadata,
      uploaded: new Date().toISOString(),
      size: buffer.length,
    };
    await fs.writeFile(metadataPath, JSON.stringify(metadata));

    return new R2ObjectImpl(key, buffer, {
      httpMetadata: options?.httpMetadata,
      customMetadata: options?.customMetadata,
    });
  }

  private async readableStreamToBuffer(stream: ReadableStream): Promise<Buffer> {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = Buffer.alloc(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    const filePath = this.getFilePath(key);
    
    if (!this.validatePath(filePath)) {
      return null;
    }

    const metadataPath = this.getMetadataPath(key);

    try {
      const [data, metadataRaw] = await Promise.all([
        fs.readFile(filePath),
        fs.readFile(metadataPath, 'utf-8').catch(() => null),
      ]);

      let metadata: {
        httpMetadata?: R2HTTPMetadata;
        customMetadata?: Record<string, string>;
        uploaded?: string;
      } = {};

      if (metadataRaw) {
        try {
          metadata = JSON.parse(metadataRaw);
        } catch {
          // ignore parse errors
        }
      }

      return new R2ObjectImpl(key, data, {
        httpMetadata: metadata.httpMetadata,
        customMetadata: metadata.customMetadata,
        uploaded: metadata.uploaded ? new Date(metadata.uploaded) : undefined,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const filePath = this.getFilePath(key);
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
          const metadataPath = this.getMetadataPath(key);
          let metadata: {
            httpMetadata?: R2HTTPMetadata;
            customMetadata?: Record<string, string>;
            uploaded?: string;
          } = {};

          try {
            const metadataRaw = await fs.readFile(metadataPath, 'utf-8');
            metadata = JSON.parse(metadataRaw);
          } catch {
            // ignore
          }

          objects.push(
            new R2ObjectImpl(
              key,
              Buffer.alloc(0),
              {
                httpMetadata: metadata.httpMetadata,
                customMetadata: metadata.customMetadata,
                uploaded: metadata.uploaded ? new Date(metadata.uploaded) : undefined,
              }
            )
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
    return this.get(key);
  }
}

export function createStorageAdapter(basePath: string): FileSystemR2Adapter {
  return new FileSystemR2Adapter(basePath);
}

export type R2Bucket = FileSystemR2Adapter;
