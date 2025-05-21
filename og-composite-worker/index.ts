// og-composite-worker.js
// Cloudflare Worker for receiving Gen0 image, Gen1 image, Poet Name and Poet Class
// and creating a composite image.

import { Resvg, initWasm } from '@resvg/resvg-wasm';
import satori from 'satori';
// @ts-ignore
import wasm from './index_bg.wasm';

const fontUrl = 'https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Me5WZLCzYlKw.ttf';
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
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      const response = new Response(cachedResponse.body, cachedResponse);
      response.headers.set('X-Cache-Status', 'HIT');
      return response;
    }

    try {
      const url = new URL(request.url);
      const g0 = url.searchParams.get('g0');
      let g1 = url.searchParams.get('g1');
      const poetName = url.searchParams.get('name') || 'Unknown';
      const poetClass = url.searchParams.get('class') || '';

      if (!g0 || !g1) {
        error('Missing g0 or g1');
        return new Response('Missing image URLs', { status: 400 });
      }

      log('Received request for:', { poetName, poetClass });

      if (g1.startsWith('https://ipfs.io/ipfs/')) {
        g1 = g1.replace('https://ipfs.io/ipfs/', 'https://findlostpoets.xyz/ipfs/') + "?resize=600&format=jpg";
        log('Redirected g1 to resized:', g1);
      }

      // Fetch g0 & measure timing 
      const tG0 = Date.now();
      const g0Res = await fetch(new Request(g0, {
        headers: { 'Accept': 'image/jpeg,image/*,*/*;q=0.8' },
        cf: { cacheEverything: true, cacheTtl: 86400 }
      } as CFRequestInit));
      log('Fetched g0 in', Date.now() - tG0, 'ms', '-', g0Res.status);

      const g0Type = g0Res.headers.get('Content-Type') || '';
      if (!g0Res.ok || !g0Type.startsWith('image/')) {
        error(`Invalid g0 image: status=${g0Res.status}, type=${g0Type}`);
        return new Response('Invalid g0 image', { status: 502 });
      }
      const g0Buffer = await g0Res.arrayBuffer();
      const g0DataUrl = bufferToDataURI(g0Buffer, g0Type);

      // Fetch g1
      // Browser-like headers to bypass Cloudflare challenge
      const g1Headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
        'Referer': 'https://findlostpoets.xyz/',
        'Accept-Language': 'en-US,en;q=0.9'
      };

      let g1Res: Response;
      let g1Type: string;
      let g1Buffer: ArrayBuffer;

      const tG1 = Date.now();
      const g1Request = new Request(g1, {
        headers: g1Headers,
        cf: { cacheEverything: true, cacheTtl: 86400 }
      } as CFRequestInit);

      // First attempt
      g1Res = await fetch(g1Request);
      g1Type = g1Res.headers.get('Content-Type') || '';
      log('Fetched g1 in', Date.now() - tG1, 'ms -', g1Res.status);
      log('g1 URL fetched:', g1);

      if (!g1Res.ok || !g1Type.startsWith('image/')) {
        const bodyText = await g1Res.text();
        error('g1 1st fetch failed: status=', g1Res.status, ', type=', g1Type);
        error('403 body sample:', bodyText.slice(0, 100));

        // Retry once
        log('Retrying g1 fetch after 300ms...');
        await new Promise(r => setTimeout(r, 300));

        const g1Retry = await fetch(new Request(g1, {
          headers: g1Headers,
          cf: { cacheEverything: true, cacheTtl: 86400 }
        } as CFRequestInit));

        g1Type = g1Retry.headers.get('Content-Type') || '';
        if (!g1Retry.ok || !g1Type.startsWith('image/')) {
          error(`g1 retry failed: status=${g1Retry.status}, type=${g1Type}`);
          return new Response('Invalid g1 image', { status: 502 });
        }

        g1Res = g1Retry;
        log('g1 retry succeeded.');
      }

      // Continue with valid g1 image
      g1Buffer = await g1Res.arrayBuffer();
      const g1DataUrl = bufferToDataURI(g1Buffer, g1Type);

      if (!wasmInitialized) {
        const t0 = Date.now();
        await initWasm(wasm);
        wasmInitialized = true;
        log('WASM initialized in', Date.now() - t0, 'ms');
      }

      const fontRes = await fetch(fontUrl);
      if (!fontRes.ok) {
        error('Failed to load Roboto font');
        return new Response('Failed to load Roboto font', { status: 500 });
      }
      const robotoFont = await fontRes.arrayBuffer();
      log('Font loaded');

      const tSvg = Date.now();
      const svg = await satori({
        type: 'div',
        props: {
          style: {
            display: 'flex',
            flexDirection: 'column',
            width: 1240,
            height: 640,
            backgroundColor: '#141414',
            color: '#E8E8E8',
            fontFamily: 'Roboto',
            justifyContent: 'flex-start',
            alignItems: 'center',
            padding: '20px'
          },
          children: [
            {
              type: 'div',
              props: {
                style: { fontSize: 32, marginBottom: '20px' },
                children: `${poetName} – ${poetClass}`,
              }
            },
            {
              type: 'div',
              props: {
                style: {
                  display: 'flex',
                  flexDirection: 'row',
                  gap: '20px',
                },
                children: [
                  {
                    type: 'img',
                    props: {
                      src: g0DataUrl,
                      width: 600,
                      height: 560,
                      style: {
                        objectFit: 'cover'
                      }
                    }
                  },
                  {
                    type: 'img',
                    props: {
                      src: g1DataUrl,
                      width: 600,
                      height: 560,
                      style: {
                        objectFit: 'cover'
                      }
                    }
                  }
                ]
              }
            }
          ]
        }
      }, {
        width: 1240,
        height: 640,
        fonts: [{ name: 'Roboto', data: robotoFont, weight: 400, style: 'normal' }]
      });
      log('SVG generated in', Date.now() - tSvg, 'ms');

      // Convert SVG to PNG
      const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1240 } });
      const png = resvg.render().asPng();

      const response = new Response(png, {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=31536000, immutable' // 1 year
        }
      });

      // Cache the composite image in Cloudflare's cache for 1 year
      response.headers.set('X-Cache-Status', 'MISS');
      ctx.waitUntil(cache.put(request, response.clone()));
      return response;

    } catch (err) {
      error('Unhandled exception:', err);
      return new Response('Internal Error', { status: 500 });
    }
  }
};
