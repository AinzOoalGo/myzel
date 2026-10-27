export {};
/**
 * Baut das Spiel als eine einzige, eigenständige HTML-Datei (dist/index.html).
 *   bun scripts/build.ts
 */
const result = await Bun.build({
  entrypoints: ['src/main.ts'],
  target: 'browser',
  minify: true,
  sourcemap: 'none',
});
if (!result.success) {
  console.error(result.logs);
  process.exit(1);
}
const js = await result.outputs[0]!.text();
const html = await Bun.file('index.html').text();
// </script> im Code würde das Tag schließen – absichern
const safe = js.replace(/<\/script/gi, '<\\/script');
const out = html.replace('<!--APP_SCRIPT-->', () => `<script type="module">${safe}</script>`);
await Bun.write('dist/index.html', out);
console.log(`dist/index.html gebaut (${(out.length / 1024).toFixed(1)} KB)`);
