import { Resvg, initWasm } from '@resvg/resvg-wasm';
import satori from 'satori';
import wasm from './index_bg.wasm';

const fontUrl = 'https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Me5WZLCzYlKw.ttf';

let wasmInitialized = false;

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const g0 = url.searchParams.get('g0');
    let g1 = url.searchParams.get('g1');
    const poetName = url.searchParams.get('name') || 'Unknown';
    const poetClass = url.searchParams.get('class') || '';

    if (!g0 || !g1) {
      return new Response('Missing image URLs', { status: 400 });
    }

    // Redirect g1 to my resizing Cloudflare Worker ipfs-image-resizer-worker (assumes it's deployed at /ipfs/<CID>)
    if (g1.startsWith('https://ipfs.io/ipfs/')) {
      g1 = g1.replace('https://ipfs.io/ipfs/', 'https://findlostpoets.xyz/ipfs/');
    }

    // Safely initialize WASM once per execution context
    if (!wasmInitialized) {
      await initWasm(wasm);
      wasmInitialized = true;
    }

    const fontRes = await fetch(fontUrl);
    if (!fontRes.ok) {
      return new Response('Failed to load Roboto font', { status: 500 });
    }
    const robotoFont = await fontRes.arrayBuffer();

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
              style: {
                fontSize: 32,
                marginBottom: '20px',
              },
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
                    src: g0,
                    width: 600,
                    height: 560,
                    style: {
                      border: '2px solid #E8E8E8',
                      objectFit: 'cover'
                    }
                  }
                },
                {
                  type: 'img',
                  props: {
                    src: g1,
                    width: 600,
                    height: 560,
                    style: {
                      border: '2px solid #E8E8E8',
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

    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: 1240 }
    });

    const png = resvg.render().asPng();

    return new Response(png, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400'
      }
    });
  }
};
