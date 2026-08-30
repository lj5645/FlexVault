// ESM loader to handle 'cloudflare:workers' module imports in Node.js.
// Maps 'cloudflare:workers' to a local stub that provides empty implementations
// of DurableObject and waitUntil, which are only used in Cloudflare Workers mode.
//
// IMPORTANT: STUB_URL must be resolved relative to this loader file so that the
// stub is found regardless of where the project is deployed (local dev on
// Windows, Docker container at /app, etc.). Hard-coding an absolute path breaks
// the Docker image at runtime.

const STUB_URL = new URL('./cloudflare-workers-stub.mjs', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'cloudflare:workers' || specifier.startsWith('cloudflare:')) {
    return {
      url: STUB_URL,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
