// ESM loader to handle 'cloudflare:workers' module imports in Node.js.
// Maps 'cloudflare:workers' to a local stub that provides empty implementations
// of DurableObject and waitUntil, which are only used in Cloudflare Workers mode.

const STUB_URL = 'file:///d:/Exp/nodewarden/src/selfhosted/cloudflare-workers-stub.mjs';

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'cloudflare:workers' || specifier.startsWith('cloudflare:')) {
    return {
      url: STUB_URL,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
