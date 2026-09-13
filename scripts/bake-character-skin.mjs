// Run from inside the gltf-transform CLI's package directory so its own
// node_modules resolve (npm i -g @gltf-transform/cli, then npm i draco3dgltf there):
//   node bake-character-skin.mjs <in.glb> <skin.webp> <out.glb>
//
// UNUSED: colin.glb carries its own textures, and the repaint this was written
// for is deleted. Kept because the technique is the fix if an export ever ships
// a dark skin — it bakes a replacement base colour map into a character GLB,
// which is what `baseColorMap` in src/character.ts does at runtime.
//
// Bakes a lighter atlas into the character GLB, replacing the darker
// skin it ships with, so the mobile build needs no runtime override and never
// decodes the original at all.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import fs from 'node:fs';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'draco3d.encoder': await draco3d.createEncoderModule(),
});
const doc = await io.read(process.argv[2]);
const skin = fs.readFileSync(process.argv[3]);
const textures = doc.getRoot().listTextures();
console.log('textures in GLB:', textures.map((t) => `${t.getName()} ${t.getMimeType()}`));
for (const t of textures) {
  t.setImage(skin).setMimeType('image/webp').setName('colin_diffuse_lighter');
}
await io.write(process.argv[4], doc);
console.log('wrote', process.argv[4]);
