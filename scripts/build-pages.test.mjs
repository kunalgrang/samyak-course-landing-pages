import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { test } from 'node:test';
import { buildPages, checkOutput, inventory, loadPublicFiles, repositoryRoot, validatePublicPath } from './build-pages.mjs';

const files = loadPublicFiles();
const temporaryPrefix = join(tmpdir(), 'kun86-pages-');
function fixture(t) {
  const root = mkdtempSync(temporaryPrefix);
  t.after(() => {
    if (!resolve(root).startsWith(resolve(temporaryPrefix)) || dirname(root) !== resolve(tmpdir()) || lstatSync(root).isSymbolicLink()) throw new Error('Unsafe fixture cleanup');
    rmSync(root, { recursive: true, force: true });
  });
  writeFileSync(join(root, 'pages-public-files.json'), JSON.stringify({ files }));
  mkdirSync(join(root,'functions/r'),{recursive:true});
  copyFileSync(join(repositoryRoot,'functions/r/[token].js'),join(root,'functions/r/[token].js'));
  for (const file of files) { mkdirSync(dirname(join(root, file)), { recursive: true }); copyFileSync(join(repositoryRoot, file), join(root, file)); }
  return root;
}
const write = (root, file, data = 'synthetic non-public sentinel') => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), data); };
const digest = root => createHash('sha256').update(inventory(root).map(file => `${file}:${createHash('sha256').update(readFileSync(join(root,file))).digest('hex')}`).join('\n')).digest('hex');

// Build the real repository candidate, not a source-string representation of it.
buildPages();
const output = join(repositoryRoot, 'dist-pages');

test('actual output exactly matches the 58 reviewed files, byte for byte', () => {
  assert.equal(checkOutput().length, 58);
  assert.deepEqual(inventory(output), files);
  for (const file of files) assert.deepEqual(readFileSync(join(output, file)), readFileSync(join(repositoryRoot, file)));
});

test('unknown root/nested files, future migrations and sensitive categories never enter output', t => {
  const root = fixture(t);
  const excluded = ['portal/migrations/0040_simplify_samyak_payment_plan_policy.sql', 'portal/migrations/0041_future.sql',
    'portal/worker/index.ts', 'portal/db/schema.ts', 'portal/backups/synthetic.sql', 'docs/private.md', 'README.md', 'AGENTS.md',
    'functions/r/[token].js', '.env', '.git/config', '.wrangler/state/test.sqlite', 'node_modules/example.js', 'new-internal/file.html',
    'assets/.env', 'assets/internal.sql', 'assets/new-public-looking.js', 'assets/dist/extra.js', 'assets/unused.test.js'];
  for (const file of excluded) write(root, file);
  buildPages(root);
  assert.deepEqual(inventory(join(root, 'dist-pages')), files);
  for (const file of excluded) assert.equal(existsSync(join(root, 'dist-pages', file)), false, file);
});

test('rejects traversal, encoded/Windows/absolute paths, hidden/config/test/backend paths', () => {
  for (const path of ['../outside.html', '/outside.html', 'C:/outside.html', 'assets/../x.js', 'assets\\x.js', 'assets/%2e%2e/x.js',
    'assets//x.js', 'assets/.hidden/x.js', 'assets/keys.pem', 'assets/config.json', 'assets/worker/x.js', 'portal/x.js',
    'assets/a.test.js', 'assets/backups/db.sql', 'assets/node_modules/x.js', 'assets/dist/x.js']) assert.throws(() => validatePublicPath(path), undefined, path);
});

test('rejects missing sources and duplicate manifest entries before producing output', t => {
  const root = fixture(t);
  rmSync(join(root, 'r/index.html'));
  assert.throws(() => buildPages(root));
  assert.equal(existsSync(join(root, 'dist-pages')), false);
  write(root, 'r/index.html', 'fixture');
  write(root, 'pages-public-files.json', JSON.stringify({ files: [...files, files[0]] }));
  assert.throws(() => buildPages(root));
});

test('rejects a symlink/junction in a selected source directory', t => {
  const root = fixture(t);
  const assets = join(root, 'assets');
  const replacement = join(root, 'replacement');
  // Both targets are inside this disposable fixture, verified before removal.
  assert.ok(assets.startsWith(root + sep));
  rmSync(assets, { recursive: true }); mkdirSync(replacement);
  symlinkSync(replacement, assets, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => buildPages(root), /Symlink/);
});

test('rejects linked output roots and linked nested output directories', t => {
  const root = fixture(t); mkdirSync(join(root, 'elsewhere'));
  symlinkSync(join(root, 'elsewhere'), join(root, 'dist-pages'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => buildPages(root), /Symlink/);
  const nested = fixture(t); buildPages(nested);
  mkdirSync(join(nested, 'elsewhere'));
  symlinkSync(join(nested, 'elsewhere'), join(nested, 'dist-pages/assets/linked'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => buildPages(nested), /Symlink/);
});

test('contaminated output fails closed without deleting unknown files or empty directories', t => {
  const root = fixture(t); buildPages(root);
  write(root, 'dist-pages/portal/migrations/0041_future.sql');
  assert.throws(() => buildPages(root), /Unexpected/);
  assert.equal(readFileSync(join(root, 'dist-pages/portal/migrations/0041_future.sql'), 'utf8'), 'synthetic non-public sentinel');
  const empty = fixture(t); buildPages(empty); mkdirSync(join(empty, 'dist-pages/.git'));
  assert.throws(() => checkOutput(empty), /Unexpected directory/);
});

test('repeated builds have identical filenames and content hashes', () => {
  const before = digest(output); buildPages(); assert.equal(digest(output), before);
});

test('all generated HTML/CSS local references resolve inside the approved output', () => {
  let references = 0;
  for (const file of files.filter(path => /\.(html|css)$/.test(path))) {
    const text = readFileSync(join(output, file), 'utf8');
    const matches = [...text.matchAll(/(?:src|href)=["']([^"']+)["']|url\(["']?([^)'"\s]+)["']?\)/g)];
    for (const match of matches) {
      const ref = match[1] || match[2];
      const url = new URL(ref, `https://go.samyaksion.com/${file}`);
      if (url.origin !== 'https://go.samyaksion.com') continue;
      let path = decodeURIComponent(url.pathname).slice(1);
      if (!path || path.endsWith('/')) path += 'index.html';
      assert.ok(files.includes(path), `${file} references missing output: ${path}`); references++;
    }
  }
  assert.ok(references > 40);
});

test('CCC normal/hard question banks and tracking-loader dependencies remain usable', () => {
  for (const [prefix, names] of [['ccc-mock-test/', Array.from({length:9},(_,i)=>`nq0${i+1}.txt`)],
    ['ccc-mock-test/hard/', Array.from({length:8},(_,i)=>`hd0${i+1}.txt`)]]) {
    const data = names.map(name => readFileSync(join(output,prefix,name),'utf8').trim()).join('');
    const bank = JSON.parse(gunzipSync(Buffer.from(data,'base64')).toString());
    assert.equal(bank.length, 500); assert.ok(bank.every(item => item.options.length === 4));
  }
  const legacy = Array.from({length:7},(_,i)=>readFileSync(join(output,`ccc-mock-test/p0${i+1}.txt`),'utf8').trim()).join('');
  assert.ok(gunzipSync(Buffer.from(legacy,'base64')).length > 0);
});

test('Pages routing/header controls are preserved; Functions source stays outside static output', async () => {
  const routing = JSON.parse(readFileSync(join(output,'_routes.json'),'utf8'));
  assert.deepEqual(routing, {version:1, include:['/r/*'], exclude:[]});
  assert.match(readFileSync(join(output,'_redirects'),'utf8'), /^\/r\/\* \/r\/index\.html 200\s*$/);
  assert.match(readFileSync(join(output,'_headers'),'utf8'), /Referrer-Policy: no-referrer/);
  assert.match(readFileSync(join(output,'index.html'),'utf8'), /https:\/\/samyaksion\.com\//);
  assert.equal(existsSync(join(output,'functions')), false);
  const source = readFileSync(join(repositoryRoot,'functions/r/[token].js'),'utf8');
  const { onRequest } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  let requested;
  const env = {ASSETS:{fetch: async request => {requested=request; return new Response(readFileSync(join(output,'r/index.html')));}}};
  const response = await onRequest({request:new Request('https://local.test/r/synthetic-token'),env});
  assert.equal(response.status,200); assert.equal(new URL(requested.url).pathname,'/r/');
  assert.match(await response.text(), /id="referral-form"/);
  assert.equal((await onRequest({request:new Request('https://local.test/r/token',{method:'POST'}),env})).status,405);
  assert.equal((await onRequest({request:new Request('https://local.test/r/token',{method:'HEAD'}),env})).status,200);
});

test('unexpected Pages Functions fail the build instead of adding unreviewed runtime routes', t => {
  const root=fixture(t); write(root,'functions/private.js','export const onRequest=()=>new Response("synthetic");');
  assert.throws(()=>buildPages(root), /Unexpected Pages Function/);
  assert.equal(existsSync(join(root,'dist-pages')),false);
});
