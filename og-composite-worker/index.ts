// og-composite-worker.js
// Cloudflare Worker for receiving Gen0 image, Gen1 image, Poet Name and Poet Class
// and creating a composite image.

import init, { compose } from './pkg/compositor.js';
import wasm from './pkg/compositor_bg.wasm';

let wasmInitialized = false;

async function ensureWasmInitialized() {
  if (!wasmInitialized) {
    await init({ wasm });
    wasmInitialized = true;
  }
}

interface CFRequestInit extends RequestInit {
  cf?: {
    cacheEverything?: boolean;
    cacheTtl?: number;
  };
}

export default {
  async fetch(request, env, ctx) {
    const DEBUG = env?.DEBUG === 'true';
    const log = (...args) => { if (DEBUG) console.log('[og-composite-worker]', ...args); };
    const error = (...args) => { if (DEBUG) console.error('[og-composite-worker]', ...args); };

    // Check Cloudflare cache for composite image
    // @ts-ignore
    const cache = caches.default;
    const cacheKey = new Request(request.url); // Use the original request object for cache key
    const cachedResponse = await cache.match(cacheKey);

    if (cachedResponse) {
      const response = new Response(cachedResponse.body, cachedResponse);
      log('Cache HIT.');
      response.headers.set('X-Cache-Status', 'HIT');
      return response;
    }

    const url = new URL(request.url);
    const g0Url = url.searchParams.get('g0');
    const g1Url = url.searchParams.get('g1');
    const poetName = url.searchParams.get('name') || 'Unknown';

    // 🔍 Add these for debugging:
    log('g0Url:', g0Url);
    log('g1Url:', g1Url);

    if (!g0Url || !g1Url) {
      error('Missing g0Url or g1Url');
      return new Response('Missing image URLs', { status: 400 });
    }

    log('Received request for:', { poetName });

    //  Fetch images in parallel 
    const tFetch = Date.now();

    const [g0Response, g1Response] = await Promise.all([
      fetch(g0Url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Cloudflare Worker Composite Image Generator)',
          'Accept': 'image/jpeg,image/*,*/*;q=0.8',
        },
        cf: {
          cacheEverything: true,
          cacheTtl: 86400, // Cache Gen0 image for 1 day at Cloudflare's edge
        }
      } as CFRequestInit),
      fetch(g1Url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Cloudflare Worker Composite Image Generator)',
          'Accept': 'image/jpeg,image/*,*/*;q=0.8',
        },
        cf: {
          cacheEverything: true,
          cacheTtl: 86400, // Cache Gen1 image for 1 day at Cloudflare's edge
        }
      } as CFRequestInit)
    ]);

    log('Fetched g0 in', Date.now() - tFetch, 'ms -', g0Response.status);
    log('Fetched g1 in', Date.now() - tFetch, 'ms -', g1Response.status);

    if (!g0Response.ok) {
      error('Failed to fetch Gen0 image');
      return new Response('Failed to fetch Gen0 image', { status: g0Response.status });
    }
    if (!g1Response.ok) {
      error('Failed to fetch Gen1 image');
      return new Response('Failed to fetch Gen1 image', { status: g1Response.status });
    }

    const g0Buffer = await g0Response.arrayBuffer();
    const g1Buffer = await g1Response.arrayBuffer();

    await ensureWasmInitialized();
    const composed = compose(new Uint8Array(g0Buffer), new Uint8Array(g1Buffer));

    const response = new Response(composed, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable' // 1 year
      }
    });

    // Cache the composite image in Cloudflare's cache for 1 year
    response.headers.set('X-Cache-Status', 'MISS');
    log('Cache MISS');
    ctx.waitUntil(cache.put(request, response.clone()));

    return response;
  },
};
