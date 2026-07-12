// Stub for the Cloudflare Durable Object BACKUP_TRANSFER_RUNNER.
// Self-hosted mode does not implement remote backup transfer; this stub
// returns a 409 response for scheduled backup calls (so callers skip silently)
// and a 501 response for other internal fetch calls so callers can fail
// gracefully without crashing the server.

export class BackupTransferRunnerStub {
  idFromName(_name: string): { name: string } {
    return { name: _name };
  }

  get(_id: { name: string }): BackupTransferRunnerStubFetchable {
    return new BackupTransferRunnerStubFetchable();
  }
}

class BackupTransferRunnerStubFetchable {
  async fetch(
    input: RequestInfo | URL,
    _init?: RequestInit
  ): Promise<Response> {
    const url = typeof input === 'string' ? input : (input instanceof URL ? input.href : input.url);
    // Scheduled backup runner expects 409 to silently skip when no work to do.
    if (url.includes('/internal/run-scheduled-backups')) {
      return new Response(
        JSON.stringify({ error: 'No scheduled backups configured' }),
        {
          status: 409,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        }
      );
    }
    return new Response(
      JSON.stringify({
        error: 'Remote backup transfer is not supported in self-hosted mode',
      }),
      {
        status: 501,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      }
    );
  }
}
