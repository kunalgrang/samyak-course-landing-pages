import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const OUTPUT_DIRECTORY = 'dist-pages';
export const FUNCTION_FILES = Object.freeze(['r/[token].js']);
const publicRoots = new Set(['assets', 'ccc-mock-test', 'tally-sion', 'digital-marketing-sion',
  'data-analytics-sion', 'full-stack-developer-course-sion', 'r', 'samyak-skill-circle']);
const rootFiles = new Set(['index.html', '404.html', 'robots.txt', 'sitemap.xml', '_headers', '_redirects', '_routes.json']);
const deniedSegments = /^(?:\..*|node_modules|dist|dist-pages|build|backups?|tests?|__tests__|functions|portal|worker|db|migrations|docs|source|google-apps-script)$/i;

export function validatePublicPath(file) {
  if (typeof file !== 'string' || !file || file.includes('\\') || file.includes(':') || file.includes('%')
    || file.startsWith('/') || file.split('/').some(part => !part || deniedSegments.test(part))) {
    throw new Error('Unsafe public manifest path');
  }
  const parts = file.split('/');
  if (rootFiles.has(file)) return;
  if (!publicRoots.has(parts[0]) || parts.length < 2 || /(?:^|[.\/_-])test(?:[.\/_-]|$)/i.test(parts.at(-1))
    || !/\.(?:html|css|js|png|jpe?g|webp|svg|ico|woff2?|mp4|webm|txt)$/i.test(file)
    || (/\.txt$/i.test(file) && parts[0] !== 'ccc-mock-test')) throw new Error('Unapproved public asset path');
}

export function noLinks(root, relative, finalDirectory = false) {
  const base = resolve(root);
  if (lstatSync(base).isSymbolicLink() || !lstatSync(base).isDirectory()) throw new Error('Unsafe root');
  const parts = relative.split('/');
  for (let index = 0; index < parts.length; index++) {
    const path = resolve(base, ...parts.slice(0, index + 1));
    if (!path.startsWith(base + sep)) throw new Error('Path escapes root');
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || (index < parts.length - 1 || finalDirectory ? !stat.isDirectory() : !stat.isFile())) {
      throw new Error('Symlink or unexpected file type rejected');
    }
  }
}

export function inventory(root, prefix = '', approvedFiles) {
  const result = [];
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const stat = lstatSync(join(root, relative));
    if (stat.isSymbolicLink()) throw new Error('Symlink in public output');
    if (stat.isDirectory()) {
      if (approvedFiles && !approvedFiles.some(file => file.startsWith(relative + '/'))) throw new Error('Unexpected directory in public output');
      result.push(...inventory(root, relative, approvedFiles));
    }
    else if (stat.isFile()) result.push(relative);
    else throw new Error('Unexpected public file type');
  }
  return result.sort();
}

export function loadPublicFiles(root = repositoryRoot) {
  noLinks(root, 'pages-public-files.json');
  const { files } = JSON.parse(readFileSync(join(root, 'pages-public-files.json'), 'utf8').replace(/^\uFEFF/, ''));
  if (!Array.isArray(files) || !files.length) throw new Error('Empty public manifest');
  const unique = new Set();
  for (const file of files) {
    validatePublicPath(file);
    if (unique.has(file.toLowerCase())) throw new Error('Duplicate public manifest path');
    unique.add(file.toLowerCase());
    noLinks(root, file);
  }
  for (const required of rootFiles) if (!files.includes(required)) throw new Error('Missing required Pages control/entry file');
  return [...files].sort();
}

export function checkOutput(root = repositoryRoot, files = loadPublicFiles(root)) {
  noLinks(root, OUTPUT_DIRECTORY, true);
  const output = join(root, OUTPUT_DIRECTORY);
  const actual = inventory(output, '', files);
  if (JSON.stringify(actual) !== JSON.stringify(files)) throw new Error('Public output differs from allowlist');
  for (const file of files) if (!readFileSync(join(root, file)).equals(readFileSync(join(output, file)))) {
    throw new Error('Public output differs from approved source');
  }
  return actual;
}

export function buildPages(root = repositoryRoot) {
  const files = loadPublicFiles(root);
  noLinks(root, 'functions', true);
  for (const file of FUNCTION_FILES) noLinks(root, `functions/${file}`);
  if (JSON.stringify(inventory(join(root, 'functions'), '', FUNCTION_FILES)) !== JSON.stringify(FUNCTION_FILES)) {
    throw new Error('Unexpected Pages Function source');
  }
  const output = join(root, OUTPUT_DIRECTORY);
  // Never recursively copy the repository or delete an existing directory. Reject
  // contaminated output instead of silently publishing or removing unknown files.
  if (existsSync(output)) {
    noLinks(root, OUTPUT_DIRECTORY, true);
    if (inventory(output, '', files).some(file => !files.includes(file))) throw new Error('Unexpected file in existing public output');
  } else mkdirSync(output);
  for (const file of files) {
    mkdirSync(dirname(join(output, file)), { recursive: true });
    copyFileSync(join(root, file), join(output, file));
  }
  return checkOutput(root, files);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = process.argv.includes('--check') ? checkOutput() : buildPages();
  console.log(`Pages public output verified: ${files.length} allowlisted files in ${OUTPUT_DIRECTORY}/`);
}
