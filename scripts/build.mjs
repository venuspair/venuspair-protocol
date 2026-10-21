import path from 'node:path';
import { buildSite, root } from './lib/site.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const out = path.resolve(arg('--out', path.join(root, 'dist')));
const reg = path.resolve(arg('--register', path.join(root, 'src', 'register.json')));
buildSite({ registerPath: reg, outDir: out });
console.log('built ->', out);
