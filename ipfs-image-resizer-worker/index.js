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
      const originalUrl = `https://ipfs.io/ipfs/${ipfsHash}`;

      // Use Weserv.nl to resize and convert the image to webp format
      const resizedImageUrl = `https://images.weserv.nl/?url=${encodeURIComponent(originalUrl)}&w=1024&h=1024&output=webp`;

      log(`Requested IPFS hash: ${ipfsHash}`);
      log(`Resized image URL: ${resizedImageUrl}`);

      try {
        // Attempt to fetch the resized image with cache headers and timeout
        response = await fetchWithRetry(resizedImageUrl, { 
          cf: { cacheTtl: 31536000 },     // Instruct Cloudflare to cache it for 1 year
          timeout: 5000 }                 // Optional timeout setting (can be ignored by some runtimes)
        );

        if (response.ok) {
          // Clone and store in Cloudflare cache asynchronously
          const responseClone = response.clone();
          ctx.waitUntil(cache.put(request, responseClone));
        } else {
          response = new Response('Image fetch failed', { status: 500 });
        }
      } catch (err) {
        error(`Fetch failed: ${err.message}`);
        response = new Response('Image fetch failed', { status: 500 });
      }
    } else {
      // Fallback: proxy the original request if not targeting /ipfs
      response = await fetch(request);
    }
  }

  return response;
}


