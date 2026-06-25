import type { Send } from './types';
import type { DecryptSendsArgs, DecryptVaultCoreArgs, DecryptVaultCoreResult } from './vault-decrypt';

type WorkerSuccess<T> = { id: number; ok: true; result: T };
type WorkerFailure = { id: number; ok: false; error: string };
type WorkerResponse<T> = WorkerSuccess<T> | WorkerFailure;

let worker: Worker | null = null;
let nextJobId = 1;
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (worker) return worker;
  worker = new Worker(new URL('../workers/vault-decrypt.worker.ts', import.meta.url), { type: 'module' });
  worker.addEventListener('message', (event: MessageEvent<WorkerResponse<unknown>>) => {
    const message = event.data;
    const job = pending.get(message.id);
    if (!job) return;
    pending.delete(message.id);
    if (message.ok) {
      job.resolve(message.result);
      return;
    }
    job.reject(new Error(message.error || 'Decrypt failed'));
  });
  worker.addEventListener('error', () => {
    for (const [, job] of pending) {
      job.reject(new Error('Decrypt worker failed'));
    }
    pending.clear();
    worker = null;
  });
  return worker;
}

function postJob<T>(payload: { kind: 'vault-core'; payload: DecryptVaultCoreArgs } | { kind: 'sends'; payload: DecryptSendsArgs }): Promise<T> {
  const instance = getWorker();
  if (!instance) {
    return Promise.reject(new Error('Decrypt worker unavailable'));
  }
  const id = nextJobId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    instance.postMessage({ id, ...payload });
  });
}

export function decryptVaultCoreInWorker(args: DecryptVaultCoreArgs): Promise<DecryptVaultCoreResult> {
  return postJob<DecryptVaultCoreResult>({ kind: 'vault-core', payload: args });
}

export function decryptSendsInWorker(args: DecryptSendsArgs): Promise<Send[]> {
  return postJob<Send[]>({ kind: 'sends', payload: args });
}
