# Cloudflare Workers Monorepo

This repository contains multiple Cloudflare Workers used in the [FindLostPoets](https://findlostpoets.xyz) project.

## 🧱 Workers

- **ipfs-image-resizer-worker**:  
  Fetches the 2048x2048 Gen1 IPFS poet image. Uses Weserv to fetch the IPFS images. IPFS gateways are unstable/slow. To address this, fetch from 3 different IPFS gateway servers. Trying each server until successful. For each IPFS gateway server, retry with exponential backoff.  
  **Worker URL**: https://findlostpoets.xyz/ipfs/  
  1. Route `/` – Resizes the 2048x2048 image to 1024x1024 and serves it to the route.  
  2. Route `poet.$pNam` or `PoetModal` – Serves the 2048x2048 image to 1024x1024 and serves it to the route.

- **og-composite-worker**:  
  Formats a 1240-640 image consisting of the Gen0 and Gen1 images side-by-side, with the Poet name centered above. Called by the MetaFunction in the route `poet.$pNam`.  
  **Worker URL**: https://og-composite-worker.findlostpoets.workers.dev/
## 🚀 Deployin a Worker

To deploy the Worker using Wrangler:

```bash
cd ipfs-image-resizer-worker
npx wrangler login
npx wrangler deploy
