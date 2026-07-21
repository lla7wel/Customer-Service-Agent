/**
 * Dev utility: render a sample Content Studio visual (deterministic Arabic
 * typography overlay) so operators can eyeball the composition locally.
 *
 *   npx tsx compose-sample.ts [output.jpg]
 */
import { Jimp, JimpMime } from 'jimp';
import { writeFileSync } from 'node:fs';
import { composeVisual } from '../integrations/content/compose';

async function main() {
  const out = process.argv[2] ?? 'compose-sample.jpg';
  const base = new Jimp({ width: 1080, height: 1080, color: 0xd9cbb8ff });
  const baseBuf = await base.getBuffer(JimpMime.jpeg, { quality: 92 });
  const result = await composeVisual({
    baseImage: baseBuf,
    aspect: 'feed_square',
    phrase: 'دفء يليق ببيتك، بأسعار أحلى',
    oldPrice: 250,
    newPrice: 189,
  });
  writeFileSync(out, result.jpeg);
  console.log(`written ${out} (${result.width}x${result.height})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
