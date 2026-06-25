// Stub for the Cloudflare Durable Object BACKUP_TRANSFER_RUNNER.
// Self-hosted mode does not implement remote backup transfer; this stub
// returns a 501 response for any internal fetch call so callers can fail
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
    _input: RequestInfo | URL,
    _init?: RequestInit
  ): Promise<Response> {
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
