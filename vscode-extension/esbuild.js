// esbuild.js — bundles extension + crystal-11-core into a single CJS file.
// 'vscode' stays external (host-provided). Core is bundled in via alias.

const esbuild = require('esbuild');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: 'out/extension.js',
    // vscode is provided by the host — never bundle it.
    external: ['vscode'],
    // Resolve crystal-11-core to its TS source directly.
    // esbuild handles TS natively so no separate core compile step is needed.
    alias: {
      'crystal-11-core': path.resolve(__dirname, '../core/src/index.ts'),
    },
    logLevel: 'info',
  });

  if (watch) {
    await ctx.watch();
    console.log('[esbuild] watching for changes...');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
