import http from 'node:http';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build, siteBase } from './build.mjs';

const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml','.woff2':'font/woff2','.woff':'font/woff','.ico':'image/x-icon','.mp4':'video/mp4','.webm':'video/webm','.json':'application/json','.pdf':'application/pdf'};
export function previewServer(root, base) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const pathname = decodeURIComponent(url.pathname);
      if (pathname === '/' && base !== '/') {
        res.writeHead(302, { Location: base }).end();
        return;
      }
      if (!pathname.startsWith(base)) throw new Error('Not found');
      let target = path.resolve(root, pathname.slice(base.length));
      if (target !== root && !target.startsWith(root + path.sep)) throw new Error('Not found');
      if ((await stat(target)).isDirectory()) {
        if (!pathname.endsWith('/')) {
          res.writeHead(301, { Location: pathname + '/' + url.search }).end();
          return;
        }
        target = path.join(target, 'index.html');
      }
      const data = await readFile(target);
      res.writeHead(200, {
        'Content-Type': types[path.extname(target)] || 'application/octet-stream',
        'X-Robots-Tag': 'noindex, nofollow'
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow' });
      res.end(await readFile(path.join(root, '404.html')));
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base=siteBase(process.env.SITE_BASE);
  const server=previewServer(await build(base),base);
  server.listen(Number(process.env.PORT || 4173),'127.0.0.1',()=>{
    console.log('Local A-House: http://127.0.0.1:'+server.address().port+base);
  });
}
