/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run "npm run dev" in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run "npm run deploy" to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event));
})

async function fetchWithRetry(url, options, retries = 3, backoff = 300) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) {
        return response;
      }
    } catch (err) {
      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, backoff * Math.pow(2, i)));
      }
    }
  }
  throw new Error('Max retries reached');
}

async function handleRequest(event) {
  const request = event.request;
  const cache = caches.default;
  let response = await cache.match(request);

  if (!response) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/ipfs')) {
      const ipfsHash = url.pathname.split('/ipfs/')[1];
      const originalUrl = `https://ipfs.io/ipfs/${ipfsHash}`;
      const resizedImageUrl = `https://images.weserv.nl/?url=${encodeURIComponent(originalUrl)}&w=1024&h=1024&output=webp`;

      try {
        response = await fetchWithRetry(resizedImageUrl, { cf: { cacheTtl: 31536000 }, timeout: 5000 });

        if (response.ok) {
          const responseClone = response.clone();
          event.waitUntil(cache.put(request, responseClone));
        } else {
          response = new Response('Image fetch failed', { status: 500 });
        }
      } catch (error) {
        response = new Response('Image fetch failed', { status: 500 });
      }
    } else {
      response = await fetch(request);
    }
  }

  return response;
}