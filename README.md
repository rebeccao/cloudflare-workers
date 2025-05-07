# Cloudflare Workers Monorepo

This repository contains multiple Cloudflare Workers used in the [FindLostPoets](https://findlostpoets.xyz) project.

## 🧱 Workers

- **ipfs-image-resizer-worker**: Fetches 2048x2048 Gen1 poet image, resizes it to 1024x1024 and serves it to findlostpoets production/staging routes.
- **another-worker**: (Describe purpose)

Each worker has its own `wrangler.toml` and can be deployed independently using Wrangler.


## 🚀 Deployin a Worker

To deploy the Worker using Wrangler:

```bash
cd ipfs-image-resizer-worker
npx wrangler login
npx wrangler deploy
