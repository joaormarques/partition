// Turns dist/index.html into dist/partition.html for publishing as a claude.ai Artifact.
// The Artifact host supplies the <!doctype>, <html>, <head> and <body> itself, so this
// keeps the title, stylesheet and script tags and the body's content, and nothing else.
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('dist/index.html', 'utf8');
const pick = (re, what) => {
  const m = html.match(re);
  if (!m) throw new Error(`build-artifact: could not find ${what} in dist/index.html`);
  return m;
};

const title = pick(/<title>[\s\S]*?<\/title>/, 'the <title>')[0];
const assets = [...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="\.\/assets\/[^"]+"[^>]*>(?:<\/script>)?/g)].map((m) => m[0]);
if (assets.length === 0) throw new Error('build-artifact: no ./assets/ tags found (is vite base set to "./"?)');
const body = pick(/<body[^>]*>([\s\S]*)<\/body>/, 'the <body>')[1].trim();

const page = [
  title,
  '<meta name="claude:viewport-fit-sides" content="cover">',
  ...assets,
  body,
  '',
].join('\n');

writeFileSync('dist/partition.html', page);
console.log(`dist/partition.html written (${assets.length} asset tags)`);
