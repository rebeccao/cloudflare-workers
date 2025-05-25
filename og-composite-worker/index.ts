// og-composite-worker.js
// Cloudflare Worker for receiving Gen0 image, Gen1 image, Poet Name and Poet Class
// and creating a composite image.

import { Resvg, initWasm } from '@resvg/resvg-wasm';
// @ts-ignore
import wasm from './index_bg.wasm';

let wasmInitialized = false;

// helper to convert ArrayBuffer to data URI
function bufferToDataURI(buffer: ArrayBuffer, mimeType: string): string {
  const binary = new Uint8Array(buffer);
  let binaryString = '';
  for (let i = 0; i < binary.length; i++) {
    binaryString += String.fromCharCode(binary[i]);
  }
  const base64 = btoa(binaryString);
  return `data:${mimeType};base64,${base64}`;
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
    const cacheKey = new Request(request.url, request); // Use the original request object for cache key
    const cachedResponse = await cache.match(cacheKey);

    if (cachedResponse) {
      const response = new Response(cachedResponse.body, cachedResponse);
      log('Cache HIT.');
      response.headers.set('X-Cache-Status', 'HIT');
      return response;
    }

    if (!wasmInitialized) {
        const t0 = Date.now();
        await initWasm(wasm);
        wasmInitialized = true;
        log('WASM initialized in', Date.now() - t0, 'ms');
      }

    const url = new URL(request.url);
    const g0Url = url.searchParams.get('g0');
    const g1Url = url.searchParams.get('g1');
    const poetName = url.searchParams.get('name') || 'Unknown';

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

    const g0ContentType = g0Response.headers.get('Content-Type') || 'image/jpeg';
    const g1ContentType = g1Response.headers.get('Content-Type') || 'image/jpeg';

    const g0DataUrl = bufferToDataURI(g0Buffer, g0ContentType);
    const g1DataUrl = bufferToDataURI(g1Buffer, g1ContentType);

    // Directly construct SVG string
    const svg = `
      <svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
        <rect x="0" y="0" width="1200" height="630" fill="#141414"/>
        <image x="10" y="10" width="585" height="610" href="${g0DataUrl}" preserveAspectRatio="xMidYMid slice"/>
        <image x="605" y="10" width="585" height="610" href="${g1DataUrl}" preserveAspectRatio="xMidYMid slice"/>
      </svg>
    `;

    // Convert SVG to PNG
    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: 1240 },
      background: 'rgba(20, 20, 20, 1)', // Matches your background: '#141414'
      imageRendering: 0,    // 0 for 'optimizeQuality'
      shapeRendering: 2,    // 2 for 'geometricPrecision'
      textRendering: 2,     // 2 for 'optimizeLegibility' (though no text now) 
    });
    const png = resvg.render().asPng();  

    const response = new Response(png, {
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
