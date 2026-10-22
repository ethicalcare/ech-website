import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [source, dependencies, evidence] = process.argv.slice(2);
if (!source || !dependencies) throw new Error('Provide reviewed admin source and dependency directories.');
const { build } = await import(pathToFileURL(resolve(dependencies, 'esbuild/lib/main.js')));
const output = resolve(root, 'dist/admin');
await readFile(resolve(root, 'dist/index.html'));
await mkdir(output, { recursive: true });
// Shared exports exclude the legacy local-data components from this deployment.
const shared = {
  ReferralPartners: ['SharedPartnerList', 'SharedPartnerList'],
  InlinePartnerAdd: ['SharedInlinePartner', 'PartnerForms'],
  PartnerPeople: ['SharedPartnerPeople', 'PartnerForms'],
  ReferralLink: ['SharedReferralPicker', 'PartnerForms'],
};
const result = await build({
  stdin: { contents: `import ${JSON.stringify(resolve(source, 'app/globals.css'))}; import React from 'react'; import {createRoot} from 'react-dom/client'; import {AdminWorkspace} from ${JSON.stringify(resolve(source, 'app/shared/AdminWorkspace.tsx'))}; createRoot(document.getElementById('admin-root')).render(React.createElement(AdminWorkspace));`, resolveDir: resolve(source), loader: 'tsx' },
  bundle: true, platform: 'browser', format: 'esm', target: 'es2022', jsx: 'automatic', minify: true,
  outfile: resolve(output, 'admin.js'), nodePaths: [resolve(dependencies)], sourcemap: false, legalComments: 'eof', metafile: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'shared-components', setup(api) {
    api.onLoad({filter:/\/globals\.css$/}, async args => ({contents:(await readFile(args.path,'utf8')).replace("@import 'tailwindcss';",''),loader:'css'}));
    api.onResolve({ filter: /\/(ReferralPartners|InlinePartnerAdd|PartnerPeople|ReferralLink)$/ }, args => ({ path: args.path.split('/').pop(), namespace: 'shared-components' }));
    api.onLoad({ filter: /.*/, namespace: 'shared-components' }, args => {
      const [exported, file] = shared[args.path];
      return { contents: `import {${exported}} from ${JSON.stringify(resolve(source, 'app/shared', file + '.tsx'))}; export function ${args.path}({shared}) { return <${exported} {...shared} />; }`, loader: 'tsx', resolveDir: resolve(source) };
    });
  } }],
});
for (const input of Object.keys(result.metafile.inputs)) {
  if (/\/seed\.(ts|tsx)$/.test(input)) throw new Error('Legacy seed data entered the admin bundle.');
}
if (evidence) await writeFile(resolve(evidence), JSON.stringify(result.metafile, null, 2) + '\n');
const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>Team sign in | Ethical Care at Home</title><link rel="stylesheet" href="/admin/admin.css"></head><body><div id="admin-root"></div><script type="module" src="/admin/admin.js"></script></body></html>\n';
await writeFile(resolve(output, 'index.html'), html);
console.log(JSON.stringify({ adminInputs: Object.keys(result.metafile.inputs).length, outputs: Object.values(result.metafile.outputs).map(item => ({ bytes: item.bytes })), legacySeedInputs: 0 }));
