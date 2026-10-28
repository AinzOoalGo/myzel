export {};
/**
 * Baut das Spiel als eine einzige, eigenständige HTML-Datei.
 *   bun scripts/build.ts            → dist/index.html (Testversion, mit Tempo-Regler)
 *   bun scripts/build.ts --release  → release/ (installierbare Web-App: Manifest, Offline, Icons; ohne Testwerkzeuge)
 */
const release = process.argv.includes('--release');
const outDir = release ? 'release' : 'dist';
const result = await Bun.build({
  entrypoints: ['src/main.ts'],
  target: 'browser',
  minify: true,
  sourcemap: 'none',
  define: { __RELEASE__: release ? 'true' : 'false' },
});
if (!result.success) {
  console.error(result.logs);
  process.exit(1);
}
const js = await result.outputs[0]!.text();
const html = await Bun.file('index.html').text();
// </script> im Code würde das Tag schließen – absichern
const safe = js.replace(/<\/script/gi, '<\\/script');
let out = html.replace('<!--APP_SCRIPT-->', () => `<script type="module">${safe}</script>`);
if (release) {
  out = out.replace(
    '</head>',
    () =>
      `    <link rel="manifest" href="manifest.webmanifest" />\n    <link rel="icon" type="image/png" href="favicon-32.png" />\n    <link rel="apple-touch-icon" href="apple-touch-icon.png" />\n    <meta name="apple-mobile-web-app-capable" content="yes" />\n    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />\n    <meta name="description" content="Myzel – lass ein leuchtendes Pilzgeflecht vom Waldboden bis in den ganzen Wald wachsen." />\n  </head>`,
  );
  const pkg = JSON.parse(await Bun.file('package.json').text()) as { version: string };
  // Service Worker mit Versionsnummer: neue Version = neuer Cache, alte Dateien werden aufgeräumt
  const sw = (await Bun.file('src/sw.js').text()).replace('__VERSION__', `${pkg.version}-${Date.now()}`);
  await Bun.write(`${outDir}/sw.js`, sw);
  await Bun.write(`${outDir}/manifest.webmanifest`, await Bun.file('src/manifest.webmanifest').text());
  for (const f of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'favicon-32.png']) {
    await Bun.write(`${outDir}/${f}`, Bun.file(`public/${f}`));
  }
  await Bun.write(`${outDir}/.nojekyll`, '');
}
await Bun.write(`${outDir}/index.html`, out);
console.log(`${outDir}/index.html gebaut (${(out.length / 1024).toFixed(1)} KB)${release ? ' – Release' : ''}`);
