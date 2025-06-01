// og-composite-worker.js
// Cloudflare Worker for receiving Gen0 image, Gen1 image, Poet Name and Poet Class
// and creating a composite image.

import init, { compose } from './pkg/compositor.js';
import wasm from './pkg/compositor_bg.wasm';

let wasmInitialized = false;

async function ensureWasmInitialized() {
  if (!wasmInitialized) {
    await init(wasm);
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

    const url = new URL(request.url);
    const g0Url = url.searchParams.get('g0');
    const g1Url = url.searchParams.get('g1');
    const poetName = url.searchParams.get('name') || 'Unknown';

    if (!g0Url || !g1Url) {
      error('Missing g0Url or g1Url');
      return new Response('Missing image URLs', { status: 400 });
    }

    log('Received request for:', { poetName });

    // Check Cloudflare cache for composite image
    const cacheKey = new Request(request.url); // Use the original request object for cache key
    // @ts-ignore
    const cache = caches.default;
    const cachedResponse = await cache.match(cacheKey);

    if (cachedResponse) {
      const response = new Response(cachedResponse.body, cachedResponse);
      log('📦 Cache HIT');
      response.headers.set('X-Cache-Status', 'HIT');
      return response;
    }

    log('📦 Cache MISS');
    log('🌐 g0Url:', g0Url);
    log('🌐 g1Url:', g1Url);

    try {
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

      log(`✅ Fetched g0 (${g0Response.status}) & g1 (${g1Response.status}) in ${Date.now() - tFetch}ms`);

      if (!g0Response.ok || !g1Response.ok) {
        const errTarget = !g0Response.ok ? 'Gen0' : 'Gen1';
        error(`Failed to fetch ${errTarget} image`);
        return new Response(`Failed to fetch ${errTarget} image`, {
          status: (!g0Response.ok ? g0Response.status : g1Response.status)
        });
      }

      const g0Buffer = await g0Response.arrayBuffer();
      const g1Buffer = await g1Response.arrayBuffer();
      await ensureWasmInitialized();

      const g0Array = new Uint8Array(g0Buffer);
      const g1Array = new Uint8Array(g1Buffer);

      if (!g0Array.length || !g1Array.length) {
        error('Empty buffer passed to compose');
        return new Response('Invalid image buffer', { status: 500 });
      }

      try {
        log('Calling compose with g0Array and g1Array...');
        const composed = compose(g0Array, g1Array);
        
        //if (DEBUG) {
        //  const preview = btoa(String.fromCharCode(...composed.slice(0, 60)));
        //  log('🖼 composed preview (base64):', preview);
        //}

        const response = new Response(composed, {
          headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=31536000, immutable' // 1 year
          }
        });

        // Cache the composite image in Cloudflare's cache for 1 year
        response.headers.set('X-Cache-Status', 'MISS');
        ctx.waitUntil(cache.put(request, response.clone()));

        return response;

      } catch (e: any) { 
        error('❌ compose() failed:', e);
        // Log more details about the error
        if (e instanceof Error) {
            error('Error name:', e.name);
            error('Error message:', e.message);
            error('Error stack:', e.stack);
        } else {
            error('Non-Error object caught:', e);
        }
        return new Response('Compose failed due to image data or WASM error.', { status: 500 });
      }

    } catch (e: any) {
      error('❌ Uncaught exception in fetch handler:', e);
      if (e instanceof Error) {
          error('Error name:', e.name);
          error('Error message:', e.message);
          error('Error stack:', e.stack);
      } else {
          error('Non-Error object caught:', e);
      }
      return new Response('Worker failed with exception', { status: 500 });
    }
  },
};
