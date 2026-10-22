import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { once } from 'node:events';
import { join } from 'node:path';
import { buildPages, loadPublicFiles, repositoryRoot } from './build-pages.mjs';

buildPages();
if(readdirSync(repositoryRoot).some(name => /^\.(?:env|dev\.vars)(?:\.|$)/.test(name))) throw new Error('Refusing preview with root environment file present');
const wrangler=process.env.PAGES_WRANGLER_BIN || join(repositoryRoot,'portal/node_modules/wrangler/bin/wrangler.js');
assert.ok(existsSync(wrangler),'Install portal dependencies or set PAGES_WRANGLER_BIN');
const reserve=createNetServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');
const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
const env={...process.env,WRANGLER_SEND_METRICS:'false',CI:'true',NO_COLOR:'1'};
for(const key of Object.keys(env)) if(/^(?:CLOUDFLARE_|CF_API|WRANGLER_API)/.test(key)) delete env[key];
const child=spawn(process.execPath,[wrangler,'pages','dev','dist-pages','--ip','127.0.0.1','--port',String(port),
  '--inspector-port','0','--compatibility-date',process.env.PAGES_PREVIEW_COMPATIBILITY_DATE || '2026-07-21','--log-level','error'],{cwd:repositoryRoot,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
let logs='';child.stdout.on('data',data=>logs+=data);child.stderr.on('data',data=>logs+=data);
let proxy;
try {
  const origin=`http://127.0.0.1:${port}`;
  let ready=false;
  for(let i=0;i<180;i++) {
    if(child.exitCode!==null) throw new Error(`Local Pages exited (${child.exitCode}): ${logs}`);
    try{const response=await fetch(origin+'/404.html',{signal:AbortSignal.timeout(1000)});if(response.status===200||response.status===404){ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  assert.ok(ready,'Local Pages did not start');
  let positive=0;
  for(const file of loadPublicFiles().filter(file=>!file.startsWith('_'))) {
    const response=await fetch(`${origin}/${encodeURI(file)}`,{signal:AbortSignal.timeout(10000)});
    assert.ok(response.ok || (file==='404.html'&&response.status===404),`Public file failed: ${file} (${response.status})`);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),readFileSync(join(repositoryRoot,'dist-pages',file)),file);positive++;
  }
  for(const route of ['/tally-sion/','/digital-marketing-sion/','/data-analytics-sion/','/full-stack-developer-course-sion/','/samyak-skill-circle/','/ccc-mock-test/','/ccc-mock-test/hard/','/r/']) {
    assert.equal((await fetch(origin+route)).status,200,route);positive++;
  }
  const token='kun86_synthetic_referral_token_000000000000001';
  const referral=await fetch(origin+'/r/'+token);
  assert.equal(referral.status,200);assert.match(await referral.text(),/id="referral-form"/);
  assert.equal(referral.headers.get('referrer-policy').split(',').at(-1).trim(),'no-referrer');
  const head=await fetch(origin+'/r/'+token,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  const post=await fetch(origin+'/r/'+token,{method:'POST'});assert.equal(post.status,405);assert.equal(post.headers.get('allow'),'GET, HEAD');
  const course=await fetch(origin+'/tally-sion/');assert.equal(course.headers.get('x-content-type-options'),'nosniff');
  const asset=await fetch(origin+'/assets/css/shared.css');assert.match(asset.headers.get('cache-control'),/immutable/);
  const routingResponse=await fetch(origin+'/_routes.json');assert.equal(routingResponse.status,200);assert.deepEqual(await routingResponse.json(),JSON.parse(readFileSync(join(repositoryRoot,'dist-pages/_routes.json'),'utf8')));
  const negative=['/portal/migrations/0040_simplify_samyak_payment_plan_policy.sql','/portal/migrations/0041_student_referral_forward_intents.sql',
    '/portal/worker/index.ts','/portal/db/schema.ts','/portal/seed.sql','/portal/backups/synthetic.sql','/portal/.dev.vars',
    '/docs/private.md','/README.md','/AGENTS.md','/.git/config','/.env','/.wrangler/state/synthetic.sqlite','/node_modules/test.js',
    '/functions/r/%5Btoken%5D.js','/pages-public-files.json','/scripts/build-pages.mjs','/dist-pages/index.html',
    '/unknown-internal/file.txt','/does-not-exist','/_headers','/_redirects','/api/public/referrals/resolve/local-only',
    '/api/public/certificates/verify/local-only','/verify/local-only'];
  for(const path of negative) {
    const response=await fetch(origin+path);assert.equal(response.status,404,`Internal/unavailable path unexpectedly served: ${path}`);
    assert.match(await response.text(),/Page not found/i);
  }
  console.log(`PASS: local Cloudflare Pages serves ${positive} public file/route cases; ${negative.length} excluded or Worker-only paths return 404`);
  console.log('PASS: real Pages Function GET/HEAD/POST behavior, rewrite, security headers, asset caching and custom 404 verified');
  if(process.argv.includes('--serve')) {
    // A loopback-only browser fixture: mock APIs and CSP prevent production
    // submissions, analytics and other outbound browser connections.
    proxy=createServer(async(req,res)=>{
      try {
        const url=new URL(req.url,'http://localhost');
        res.setHeader('Content-Security-Policy',"default-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-src 'none'; form-action 'self'; base-uri 'self'");
        if(url.pathname.startsWith('/api/')) {
          res.setHeader('Content-Type','application/json');
          if(url.pathname===`/api/public/referrals/resolve/${token}`) res.end(JSON.stringify({valid:true,referrer:{displayName:'Local fixture'}}));
          else if(url.pathname===`/api/public/referrals/resolve/${token}/courses`) res.end(JSON.stringify({success:true,categories:[{id:'fixture-category',name:'Local courses',courses:[{id:'fixture-course',name:'Local course'}]}]}));
          else if(url.pathname==='/api/public/referrals/submit'&&req.method==='POST') { for await(const _chunk of req){} res.end(JSON.stringify({success:true,enquiryNumber:'LOCAL-ONLY-001',validUntil:'2026-11-01'})); }
          else {res.statusCode=404;res.end(JSON.stringify({success:false}));}
          return;
        }
        const response=await fetch(origin+req.url,{method:req.method,redirect:'manual'});
        res.statusCode=response.status;
        for(const [name,value] of response.headers) if(!['content-encoding','transfer-encoding','content-length','content-security-policy'].includes(name)) res.setHeader(name,value);
        res.end(Buffer.from(await response.arrayBuffer()));
      }catch {res.statusCode=500;res.end('Local preview fixture failed');}
    });
    proxy.listen(0,'127.0.0.1');await once(proxy,'listening');
    console.log(`BROWSER_FIXTURE=http://127.0.0.1:${proxy.address().port}/r/${token}`);
    console.log('Only local mock API submissions are enabled. Send quit on stdin to close the preview.');
    await new Promise(resolve=>{process.stdin.once('data',resolve);process.stdin.once('end',resolve);process.stdin.resume();});
  }
} finally {
  if(proxy) await new Promise(resolve=>proxy.close(resolve));
  if(child.exitCode===null) {
    if(process.platform==='win32') spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
    else {child.kill('SIGTERM');await once(child,'exit');}
  }
}
