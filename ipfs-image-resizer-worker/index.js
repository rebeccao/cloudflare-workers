// ipfs-image-resizer-worker.js
// Cloudflare Worker for resizing Gen1 Lost Poet images from 2048x2048 to 1024x1024

// Register a fetch event listener that routes all incoming requests to handleRequest()
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event));
})

/**
 * Attempts to fetch a URL with retries and exponential backoff.
 *
 * @param {string} url - The URL to fetch.
 * @param {object} options - Fetch options.
 * @param {number} retries - Number of retry attempts.
 * @param {number} backoff - Initial backoff delay in milliseconds.
 * @returns {Promise<Response>} The fetched response.
 */
async function fetchWithRetry(url, options, retries = 3, backoff = 300) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) {
        return response;    // If successful, return the response immediately
      }
    } catch (err) {
      // Ignore error and retry if not on last attempt
      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, backoff * Math.pow(2, i)));
      }
    }
  }
  // If all attempts fail, throw an error
  throw new Error('Max retries reached');
}

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
 *
 * @param {FetchEvent} event - The fetch event object.
 * @returns {Promise<Response>} The response to return to the client.
 */
async function handleRequest(request, env, ctx, log, error) {
  const cache = caches.default;

  // Check if the request is already cached
  let response = await cache.match(request);
  log(`Incoming request: ${request.url}`);

  if (!response) {
    const url = new URL(request.url);

    // Only process requests that match /ipfs/{CID}
    if (url.pathname.startsWith('/ipfs')) {
      const ipfsHash = url.pathname.split('/ipfs/')[1];
      const gateways = [
        'https://ipfs.io/ipfs/',
        'https://dweb.link/ipfs/',
        'https://inbrowser.link/ipfs/'
      ];

      for (const gateway of gateways) {
        const originalUrl = `${gateway}${ipfsHash}`;
        log(`Gateway URL: ${originalUrl}`);

        // If "raw" was passed in as a URL parameter, do not resize the image. Leave it at 2048x2048
        if (url.searchParams.get("raw") === "true") {
          try {
            const rawResponse = await fetchWithRetry(originalUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'image/*,*/*;q=0.8'
              }
            });
            if (rawResponse.ok) {
              return rawResponse;
            }
          } catch (err) {
            error(`Raw fetch failed from ${gateway}: ${err.message}`);
          }
          continue; // try next gateway
        }
        const resizedImageUrl = `https://images.weserv.nl/?url=${encodeURIComponent(originalUrl)}&w=1024&h=1024&output=jpg`;
        log(`Resized image URL: ${resizedImageUrl}`);

        try {
          response = await fetchWithRetry(resizedImageUrl, {
            cf: { cacheTtl: 31536000, cacheEverything: true },
            headers: {
              'User-Agent': 'Mozilla/5.0',
              'Accept': 'image/jpeg,image/*,*/*;q=0.8'
            },
            timeout: 5000
          });

          if (response.ok) {
            const responseClone = response.clone();
            ctx.waitUntil(cache.put(request, responseClone));
            break; // Exit loop on success
          } else {
            error(`Weserv response not ok for ${gateway}`);
            response = new Response('Image fetch failed', { status: 500 });
          }
        } catch (err) {
          error(`Fetch failed using ${gateway}: ${err.message}`);
          response = new Response('Image fetch failed', { status: 500 });
        }
      }

      // If still no response, return failure
      if (!response) {
        error(`No response`);
        response = new Response('Image fetch failed', { status: 500 });
      }
    } else {
      // Fallback: proxy the original request if not targeting /ipfs
      response = await fetch(request);
    }
  }

  return response;
}


