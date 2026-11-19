import http from 'node:http';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { build, siteBase } from './build.mjs';

const base=siteBase(process.env.SITE_BASE);
const root=await build(base);
const port=Number(process.env.PORT || 4173);
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml','.woff2':'font/woff2','.woff':'font/woff','.ico':'image/x-icon','.mp4':'video/mp4','.webm':'video/webm','.json':'application/json','.pdf':'application/pdf'};
http.createServer(async(req,res)=>{
  try{
    let pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(pathname==='/'&&base!=='/'){res.writeHead(302,{Location:base}).end();return;}
    if(!pathname.startsWith(base)) throw new Error('Not found');
    let target=path.resolve(root,pathname.slice(base.length));
    if(target!==root&&!target.startsWith(root+path.sep)) throw new Error('Not found');
    if((await stat(target)).isDirectory()){
      if(!pathname.endsWith('/')){res.writeHead(301,{Location:pathname+'/'+(new URL(req.url,'http://localhost')).search}).end();return;}
      target=path.join(target,'index.html');
    }
    const data=await readFile(target);
    res.writeHead(200,{'Content-Type':types[path.extname(target)] || 'application/octet-stream','X-Robots-Tag':'noindex, nofollow'});
    res.end(req.method==='HEAD'?undefined:data);
  }catch{
    res.writeHead(404,{'Content-Type':'text/html; charset=utf-8','X-Robots-Tag':'noindex, nofollow'});
    res.end(await readFile(path.join(root,'404.html')));
  }
}).listen(port,'127.0.0.1',()=>console.log('Local A-House: http://127.0.0.1:'+port+base));
