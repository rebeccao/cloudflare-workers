// ipfs-image-resizer-worker.js
// Cloudflare Worker for loading IPFS Gen1 images with optional resizing and format conversion

const GATEWAYS = [
  'https://w3s.link/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
  'https://dweb.link/ipfs/'
];

export default {
  async fetch(request, env, ctx) {
    const DEBUG = env.DEBUG === 'true';

    function log(...args) {
      if (DEBUG) console.log(...args);
    }

    function error(...args) {
      if (DEBUG) console.error(...args);
    }

    return handleRequest(request, env, ctx, log, error);
  }
};

/**
 * Main request handler for the Worker.
*/
async function handleRequest(request, env, ctx, log, error) {
  const url = new URL(request.url);
  const cid = url.pathname.split('/').pop();
  
  const resize = parseInt(url.searchParams.get('resize') || '', 10); // e.g., 1024
  const format = url.searchParams.get('format'); // webp, jpeg, etc.

  if (!cid) {
    error(`Missing CID in request URL`);
    return new Response('Missing CID in URL', { status: 400 });
  }

  const cache = caches.default;
  const cacheKey = new Request(url.toString(), request);
  const cachedResponse = await cache.match(cacheKey);
  if (cachedResponse) {
    log(`Cache HIT for ${cid}`);
    return cachedResponse;
  }

  // Parallel fetch from IPFS
  let originResponse;
  try {
    const attempts = GATEWAYS.map(async base => {
      const res = await fetch(base + cid, { cf: { cacheTtl: 3600 } });
      if (!res.ok) throw new Error(`Gateway ${base} failed with ${res.status}`);
      return res;
    });
    originResponse = await Promise.any(attempts);
  } catch (err) {
    error(`All gateways failed: ${err}`);
    return new Response('Failed to fetch from all gateways', { status: 504 });
  }

  if (!originResponse.ok) {
    error(`Failed to fetch image, status: ${originResponse.status}`);
    return new Response('Failed to fetch image', { status: originResponse.status });
  }

  const imageOptions = {
    fit: 'cover',
    format: format || 'auto'
  };
  if (!isNaN(resize)) imageOptions.width = resize;

  const weservUrl = `https://images.weserv.nl/?url=${encodeURIComponent(originResponse.url)}${
    !isNaN(resize) ? `&w=${resize}&h=${resize}` : ''
  }${format ? `&output=${format}` : ''}`;

  log(`Weserv resize URL: ${weservUrl}`);

  const processed = await fetch(weservUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'image/*,*/*;q=0.8'
    }
  });

  if (!processed.ok) {
    error(`Image processing failed, status: ${processed.status}`);
    return new Response('Image processing failed', { status: processed.status });
  }

  // Cache the final resized response
  const finalResponse = new Response(processed.body, {
    status: processed.status,
    headers: {
      'Content-Type': processed.headers.get('Content-Type') || 'image/jpg',
      'Cache-Control': 'public, max-age=31536000, stale-while-revalidate=86400'
    }
  });

  ctx.waitUntil(cache.put(cacheKey, finalResponse.clone()));
  log(`Response cached and returned for ${cid}`);
  return finalResponse;
}