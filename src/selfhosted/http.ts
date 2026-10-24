import http from 'http';
import { Readable } from 'stream';

export interface HttpAdapterOptions {
  /**
   * Trust X-Forwarded-* / X-Real-IP headers. Only enable this when the server
   * sits behind a reverse proxy that overwrites those headers.
   */
  trustProxy: boolean;
  /** Hard cap for a single request body, including attachment uploads. */
  maxUploadBytes: number;
}

export interface NodeRequestConversion {
  request: Request;
  /** Non-null when the request must be rejected before reaching the router. */
  rejection?: Response;
}

function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

function resolveProtocol(req: http.IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = firstHeaderValue(req.headers['x-forwarded-proto']);
    const protocol = forwarded?.split(',')[0]?.trim();
    if (protocol === 'http' || protocol === 'https') return protocol;
  }
  return (req.socket as unknown as { encrypted?: boolean })?.encrypted ? 'https' : 'http';
}

function resolveHost(req: http.IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwardedHost = firstHeaderValue(req.headers['x-forwarded-host']);
    const host = forwardedHost?.split(',')[0]?.trim();
    if (host) return host;
  }
  return firstHeaderValue(req.headers['host']) || 'localhost';
}

function buildHeaders(req: http.IncomingMessage, trustProxy: boolean): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }

  // CF-Connecting-IP is a Cloudflare-platform header. In self-hosted mode there
  // is no guarantee that a reverse proxy overwrites it, and rate limiting trusts
  // it above the other headers, so always drop it here and rely on X-Real-IP /
  // X-Forwarded-For (which the documented proxy config sets).
  headers.delete('cf-connecting-ip');

  if (!trustProxy) {
    // Without an explicitly trusted proxy these headers are attacker-controlled.
    // Strip them and inject the real socket address so per-IP rate limits cannot
    // be bypassed by spoofing X-Forwarded-For / X-Real-IP.
    headers.delete('x-real-ip');
    headers.delete('x-forwarded-for');
    headers.delete('x-forwarded-proto');
    headers.delete('x-forwarded-host');

    const remoteAddress = req.socket?.remoteAddress;
    if (remoteAddress) headers.set('x-real-ip', remoteAddress);
  }

  return headers;
}

/**
 * Enforce the upload cap for chunked bodies too. Content-Length can be omitted
 * (Transfer-Encoding: chunked), which would otherwise let a client stream
 * unbounded data past MAX_UPLOAD_BYTES.
 */
function enforceBodyLimit(stream: ReadableStream<Uint8Array>, maxBytes: number): ReadableStream<Uint8Array> {
  let received = 0;
  const limiter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > maxBytes) {
        controller.error(new Error(`Request body exceeds the ${maxBytes} byte limit`));
        return;
      }
      controller.enqueue(chunk);
    },
  });
  return stream.pipeThrough(limiter);
}

function hasRequestBody(req: http.IncomingMessage, method: string): boolean {
  if (method === 'GET' || method === 'HEAD') return false;

  const contentLength = firstHeaderValue(req.headers['content-length']);
  if (contentLength !== null) {
    const parsed = Number(contentLength);
    return !Number.isFinite(parsed) || parsed > 0;
  }

  return req.headers['transfer-encoding'] !== undefined;
}

/**
 * Convert a Node request into a Fetch Request without buffering the body.
 * The caller is responsible for streaming the response back to Node.
 */
export function nodeRequestToWebRequest(
  req: http.IncomingMessage,
  options: HttpAdapterOptions
): NodeRequestConversion {
  const method = req.method || 'GET';
  const protocol = resolveProtocol(req, options.trustProxy);
  const host = resolveHost(req, options.trustProxy);
  const url = `${protocol}://${host}${req.url || '/'}`;
  const headers = buildHeaders(req, options.trustProxy);

  const contentLengthRaw = firstHeaderValue(req.headers['content-length']);
  const contentLength = contentLengthRaw !== null ? Number(contentLengthRaw) : Number.NaN;
  if (Number.isFinite(contentLength) && contentLength > options.maxUploadBytes) {
    return {
      // A body-less request is enough to apply CORS headers to the rejection.
      request: new Request(url, { method, headers }),
      rejection: new Response(
        JSON.stringify({
          error: 'Payload too large',
          error_description: `Request body exceeds the ${options.maxUploadBytes} byte limit`,
        }),
        {
          status: 413,
          // The unread body would otherwise keep the socket half-open.
          headers: { 'Content-Type': 'application/json', Connection: 'close' },
        }
      ),
    };
  }

  const init: RequestInit & { duplex?: 'half' } = { method, headers };
  if (hasRequestBody(req, method)) {
    // Stream instead of Buffer.concat(req): large attachments would otherwise
    // be copied fully into memory (and then copied again by the storage layer).
    const body = Readable.toWeb(req) as unknown as ReadableStream<Uint8Array>;
    init.body = enforceBodyLimit(body, options.maxUploadBytes);
    init.duplex = 'half';
  }

  return { request: new Request(url, init) };
}

/** Stream a Fetch Response back to a Node ServerResponse with backpressure. */
export async function webResponseToNodeResponse(
  response: Response,
  res: http.ServerResponse
): Promise<void> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  res.writeHead(response.status, headers);

  if (!response.body) {
    res.end();
    return;
  }

  const reader = response.body.getReader();
  let finished = false;

  res.on('close', () => {
    if (!finished) {
      void reader.cancel().catch(() => undefined);
    }
  });

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      if (!res.write(Buffer.from(value))) {
        await new Promise<void>((resolve) => {
          // Resolve on close too, otherwise a client abort mid-body leaves the
          // handler waiting for a 'drain' that will never fire.
          const done = () => {
            res.off('drain', done);
            res.off('close', done);
            resolve();
          };
          res.once('drain', done);
          res.once('close', done);
        });
      }
    }
    finished = true;
    res.end();
  } catch (error) {
    finished = true;
    try {
      await reader.cancel();
    } catch {
      // Ignore cancellation races.
    }
    if (!res.destroyed) res.destroy(error instanceof Error ? error : undefined);
  }
}
