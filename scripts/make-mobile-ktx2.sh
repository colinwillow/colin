#!/usr/bin/env bash
# Rebuilds the KTX2 mobile asset set from the WebP mobile set.
#
# Run after a re-export of kitchen_room_mobile.glb or the mobile lightmaps.
# KTX2 keeps textures compressed in GPU memory where WebP does not: the room
# goes from ~382 MB to ~95 MB, which is what makes a phone browser comfortable.
#
# Requires:
#   npm i -g @gltf-transform/cli
#   npm i sharp   (inside the CLI's own package — it is an optional dependency,
#                  and without it the PNG step below silently does nothing)
#   KTX-Software >= 4.4  https://github.com/KhronosGroup/KTX-Software/releases
#
# Version notes, because these move: gltf-transform 4.5 calls
# `ktx create --assign-tf`, which KTX-Software 4.3 does not have — it fails per
# texture with "Option 'assign-tf' does not exist" and quietly leaves everything
# uncompressed. And KTX-Software cannot read WebP at all, hence the PNG step.
set -euo pipefail

KITCHEN="$(dirname "$0")/../public/kitchen"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> decoding WebP textures to PNG (KTX-Software cannot read WebP)"
gltf-transform png "$KITCHEN/kitchen_room_mobile.glb" "$WORK/rgb.glb" --formats "*"

echo "==> ETC1S for colour"
gltf-transform etc1s "$WORK/rgb.glb" "$WORK/etc1s.glb" \
  --slots "{baseColorTexture,emissiveTexture}" --quality 160

echo "==> UASTC for normal and roughness (ETC1S artifacts show badly on normals)"
gltf-transform uastc "$WORK/etc1s.glb" "$WORK/uastc.glb" \
  --slots "{normalTexture,metallicRoughnessTexture}" --level 2 --rdo 4

echo "==> re-applying Draco (gltf-transform decodes it to work on the file)"
gltf-transform draco "$WORK/uastc.glb" "$KITCHEN/kitchen_room_mobile_ktx2.glb"

echo "==> lightmaps: UASTC, sRGB, RDO"
# UASTC rather than ETC1S: lightmaps are smooth gradients, which ETC1S bands.
# RDO lambda 2.0 roughly halves the size for about 10 dB of PSNR (54.8 -> 45.0),
# which is still far above where banding appears. Without it the four atlases
# come to 10.9 MB instead of 8.6 MB.
mkdir -p "$KITCHEN/lightmaps_mobile_ktx2"
for n in LM_Arch LM_Cabinetry LM_Props LM_Interactive; do
  python3 -c "from PIL import Image; Image.open('$KITCHEN/lightmaps_mobile/$n.webp').convert('RGB').save('$WORK/$n.png')"
  ktx create --format R8G8B8_SRGB --assign-tf srgb --encode uastc --uastc-quality 3 \
    --uastc-rdo --uastc-rdo-l 2.0 --zstd 22 --generate-mipmap \
    "$WORK/$n.png" "$KITCHEN/lightmaps_mobile_ktx2/$n.ktx2"
done

echo "==> done. kitchen_lightmaps_mobile_ktx2.json points at these."
