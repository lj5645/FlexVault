// Stub for 'cloudflare:workers' module.
// Provides empty implementations of DurableObject and waitUntil for Node.js
// self-hosted mode. These are only used by Cloudflare Durable Objects.

export class DurableObject {
  constructor(_ctx, _env) {}
}

export function waitUntil(_promise) {
  // No-op in Node.js self-hosted mode.
  // In Cloudflare Workers, this extends the lifetime of the request.
}
