// Assigns the head's textures by material name and writes a GLB that carries
// them, so they can go through the KTX2 pass with everything else.
// colin_head.glb ships four materials and zero images.
//
// Run from inside the gltf-transform CLI's package directory so its own
// node_modules resolve, then compress:
//   node bake-head-textures.mjs colin_head.glb out.glb colin_main=head.webp hair=hair.webp eyes=eyes.webp
//   gltf-transform png out.glb rgb.glb --formats "*"
//   gltf-transform etc1s rgb.glb etc.glb --slots baseColorTexture --quality 200
//   gltf-transform draco etc.glb colin_head_ktx2.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import fs from 'node:fs';

const [, , input, output, ...pairs] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const wanted = new Map(pairs.map((p) => p.split('=')));

for (const material of doc.getRoot().listMaterials()) {
  const file = wanted.get(material.getName());
  if (!file) { console.log('  no texture for', material.getName()); continue; }
  material.setBaseColorTexture(
    doc.createTexture(material.getName()).setImage(fs.readFileSync(file)).setMimeType('image/webp'),
  );
  // Base colour factor multiplies the map; black times anything is black.
  material.setBaseColorFactor([1, 1, 1, material.getBaseColorFactor()[3]]);
  console.log('  ', material.getName(), '<-', file.split('/').pop());
}
await io.write(output, doc);
console.log('wrote', output);
