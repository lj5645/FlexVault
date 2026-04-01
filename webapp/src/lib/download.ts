export function downloadBytesAsFile(bytes: Uint8Array, fileName: string, mimeType: string): void {
  const payload = bytes.slice();
  const blob = new Blob([payload], { type: mimeType || 'application/octet-stream' });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName || 'download.bin';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

export interface DownloadProgressState {
  loaded: number;
  total: number | null;
  percent: number | null;
}

type ProgressCallback = (progress: DownloadProgressState) => void;

function parseContentLength(response: Response): number | null {
  const raw = String(response.headers.get('Content-Length') || '').trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function readResponseBytesWithProgress(
  response: Response,
  onProgress?: ProgressCallback
): Promise<Uint8Array> {
  const total = parseContentLength(response);
  const report = (loaded: number) => {
    onProgress?.({
      loaded,
      total,
      percent: total ? Math.max(0, Math.min(100, Math.round((loaded / total) * 100))) : null,
    });
  };

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    report(bytes.byteLength);
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  report(0);

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    loaded += value.byteLength;
    report(loaded);
  }

  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  report(loaded);
  return bytes;
}
