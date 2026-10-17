import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { buildPages, repositoryRoot } from './build-pages.mjs';
const dependency = process.env.PAGES_HAPPY_DOM || join(repositoryRoot,'portal/node_modules/happy-dom/lib/index.js');
const { Window } = await import(pathToFileURL(dependency).href);
buildPages();
const token = 'kun86_synthetic_referral_token_000000000000001';
const output = join(repositoryRoot,'dist-pages');
const waitFor = async predicate => { for(let i=0;i<100;i++){ if(predicate()) return; await new Promise(resolve=>setTimeout(resolve,10)); } assert.fail('Expected referral state was not reached'); };
async function page(t, path = token, retry = false) {
  const window = new Window({url:`http://localhost/r/${path}`,settings:{enableJavaScriptEvaluation:true,
    disableJavaScriptFileLoading:true,disableCSSFileLoading:true,disableIframePageLoading:true}});
  t.after(()=>window.close());
  const calls=[]; let posts=0;
  window.fetch = async (url, options={}) => {
    assert.ok(String(url).startsWith('/api/public/referrals/'), 'No real network requests allowed');
    calls.push({url,options});
    if(url === `/api/public/referrals/resolve/${token}`) return {ok:true,json:async()=>({valid:true,referrer:{displayName:'Local fixture'}})};
    if(url === `/api/public/referrals/resolve/${token}/courses`) return {ok:true,json:async()=>({success:true,categories:[{id:'fixture-category',name:'Local courses',courses:[{id:'fixture-course',name:'Local course'}]}]})};
    assert.equal(url,'/api/public/referrals/submit'); posts++;
    if(retry && posts === 1) return {ok:false};
    return {ok:true,json:async()=>({success:true,enquiryNumber:'LOCAL-ONLY-001',validUntil:'2026-11-01'})};
  };
  window.document.write(readFileSync(join(output,'r/index.html'),'utf8'));
  await window.happyDOM.waitUntilComplete();
  window.eval(readFileSync(join(output,'assets/js/referral-form.js'),'utf8'));
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  return {window,calls,document:window.document,submit:()=>window.document.getElementById('referral-form').dispatchEvent(new window.Event('submit',{cancelable:true,bubbles:true}))};
}
function fill(document) {
  document.getElementById('full-name').value='Synthetic local test';
  document.getElementById('mobile').value='9999999999';
  document.getElementById('email').value='synthetic@example.test';
  document.getElementById('course').value='fixture-course';
  document.getElementById('consent').checked=true;
}

test('generated referral form resolves a link, groups courses, validates consent and submits only to mocks', async t=>{
  const p=await page(t);
  await waitFor(()=>!p.document.getElementById('referral-form').classList.contains('is-hidden'));
  assert.equal(p.document.querySelector('optgroup').label,'Local courses');
  assert.equal(p.document.getElementById('referrer-name').textContent,'Local fixture');
  p.submit(); assert.equal(p.calls.length,2);
  assert.equal(p.document.getElementById('consent').getAttribute('aria-invalid'),'true');
  fill(p.document); p.submit();
  await waitFor(()=>!p.document.getElementById('success-panel').classList.contains('is-hidden'));
  const post=p.calls.at(-1);
  assert.deepEqual(JSON.parse(post.options.body),{token,name:'Synthetic local test',mobile:'9999999999',email:'synthetic@example.test',courseId:'fixture-course',consent:true});
  assert.match(post.options.headers['Idempotency-Key'],/^[a-f0-9]{32}$/);
  p.submit(); assert.equal(p.calls.length,3);
  p.document.querySelector('[data-lang-button="hi"]').click(); assert.equal(p.document.documentElement.lang,'hi');
});

test('invalid generated referral path makes no API request',async t=>{
  const p=await page(t,'invalid');
  assert.equal(p.document.getElementById('invalid-panel').classList.contains('is-hidden'),false);
  assert.equal(p.calls.length,0);
});

test('failed mocked submission preserves idempotency key for a bounded user retry',async t=>{
  const p=await page(t,token,true);
  await waitFor(()=>!p.document.getElementById('referral-form').classList.contains('is-hidden'));
  fill(p.document);p.submit();
  await waitFor(()=>!p.document.getElementById('submit-button').disabled);
  p.submit();await waitFor(()=>!p.document.getElementById('success-panel').classList.contains('is-hidden'));
  const posts=p.calls.filter(call=>call.url==='/api/public/referrals/submit');
  assert.equal(posts.length,2);assert.equal(posts[0].options.headers['Idempotency-Key'],posts[1].options.headers['Idempotency-Key']);
});
