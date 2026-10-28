// Erzeugt die App-Icons aus assets/icon.svg (einmalig, Ergebnis liegt in public/).
//   node scripts/icons.cjs
const sharp = require(process.env.SHARP_PATH || 'sharp');
const fs = require('fs');
const svg = fs.readFileSync(__dirname + '/../assets/icon.svg');
(async () => {
  for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180], ['favicon-32.png', 32]]) {
    await sharp(svg, { density: 300 }).resize(size, size).png().toFile(__dirname + '/../public/' + name);
  }
  // „maskable“: Motiv kleiner, damit runde/eckige Icon-Masken nichts abschneiden
  const inner = await sharp(svg, { density: 300 }).resize(410, 410).png().toBuffer();
  await sharp({ create: { width: 512, height: 512, channels: 4, background: '#14110e' } })
    .composite([{ input: inner, gravity: 'center' }]).png().toFile(__dirname + '/../public/icon-maskable-512.png');
  console.log('Icons erzeugt');
})();
