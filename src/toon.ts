// The other way he could look: flat, banded, drawn.
//
// An experiment with a switch on it, not a decision — the point is to be able to
// put the two next to each other. Nothing here is destructive: the patch is
// installed once and driven by a uniform, so turning it off is an assignment
// rather than a recompile, and the shipped physically-based look is exactly what
// comes back.
//
// WHAT ACTUALLY MAKES THE LOOK. Not brightness — steps. A sphere under a smooth
// falloff reads as a sphere however bright it is; what makes it read as a
// DRAWING is that the gradient is thrown away and replaced by flat regions with
// a hard line between them. So the number that matters is `bands`.
//
// The floor is the other half: the dark band never falls to black, it keeps a
// fraction of full light, so the shadow side holds its own colour instead of
// going to a hole. That is why a toon shadow on a red coat is still red.
//
// It is a RAMP ON THE DIFFUSE IRRADIANCE, not on dotNL itself, and that is the
// one thing worth getting right. `dotNL` in three's chunk feeds the specular
// term as well as the diffuse one, so ramping it bands the HIGHLIGHTS too —
// which on a roughness-0.75 face is a set of hard white blobs sliding around his
// forehead, the exact opposite of flat. Ramped one line later, the light lands in
// steps and the specular stays a highlight.
//
// Four things together are what read as "cel shaded", and only the first is the
// one people name:
//
//   the ramp       diffuse light in steps instead of a gradient
//   the rim        a lit edge where the surface turns away from the lens
//   the outline    an actual ink line, from a back-facing hull one size up
//   the glow       the texture lifting itself slightly, so colour looks emitted
//
// Ported from the ramp in `colinwillow/plutopia`, which is on three r128 where
// the lighting chunk still said `geometry.normal`. In r185 it is `geometryNormal`
// and the substring below was checked against the pinned copy in node_modules —
// it occurs exactly once.
import * as THREE from 'three';
import type { Character } from './character';

export interface ToonConfig {
  /** 0 is the physically-based look this shipped with, 1 is fully banded. */
  amount: number;
  /** How many steps the diffuse falloff is cut into. Two is the classic read. */
  bands: number;
  /** How hard each step's edge is. Toward 0 it is ink; toward 0.3 it is a fade. */
  soft: number;
  /** What the darkest band keeps of full light, so shadows stay coloured. */
  floor: number;
  /** A lit edge where he turns away from the lens. */
  rim: number;
  rimPower: number;
  rimColor: string;
  /** The texture lifting itself — colour that looks emitted rather than lit. */
  glow: number;
  /**
   * The most emission toon mode will let him act at, as an absolute
   * `emissiveIntensity`.
   *
   * He carries his diffuse map back as emission — 0.72 in the baked kitchen,
   * which is what holds his level up in a dark room, and 0.3 in a studio, where
   * there is real light. Stacked under a ramp with a raised floor the kitchen's
   * value blows him out, so toon mode caps it.
   *
   * A CAP RATHER THAN A FRACTION, and that is the point: a flat multiplier
   * tuned against the kitchen's 0.72 also cuts the studio's 0.3, and the
   * comparison the whole feature exists for turns into "the toon one is
   * darker". A ceiling leaves any scene already under it alone.
   */
  emissiveMax: number;
  /** Ink line thickness, roughly in pixels at 1080p. 0 is no line. */
  outline: number;
  outlineColor: string;
}

export const DEFAULT_TOON: ToonConfig = {
  amount: 0,
  bands: 3,
  soft: 0.06,
  floor: 0.38,
  rim: 0.22,
  rimPower: 3.4,
  rimColor: '#dfeaff',
  glow: 0.1,
  emissiveMax: 0.34,
  outline: 2.2,
  outlineColor: '#241c16',
};

/** Meshes that must never get an ink line round them: an outlined eyeball is a
 *  black ring in the middle of his face, and the teeth are inside his head. */
const NO_OUTLINE = ['eyes', 'teeth', 'tongue'];

/**
 * The one grade that rides on top of everything, toon or not.
 *
 * It lives here because THIS IS THE ONLY `onBeforeCompile` HIS MATERIALS GET —
 * a second module setting one would silently replace this one. `look.ts` owns
 * what the number is; this owns where it lands in the shader.
 */
export interface Grade {
  /** 1 leaves the colour alone, 0 is greyscale, 2 is twice as vivid. */
  saturation: number;
}

export interface Toon {
  config: ToonConfig;
  /** Set the grade that applies whether or not the toon look is on. */
  setGrade: (grade: Grade) => void;
  /** Push the config at the shaders. Call after any change. */
  apply: () => void;
  /** Per frame. Keeps the emission cap in step with whatever the current room
   *  set his materials to — the scene table writes `emissiveIntensity` on every
   *  room change, and a cap computed once goes stale on the first one. */
  update: () => void;
  /** True when it is doing anything at all. */
  readonly on: boolean;
}

const KEY = 'colin.toon.v1';

export function createToon(colin: Character, config: ToonConfig = { ...DEFAULT_TOON }): Toon {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null') as Partial<ToonConfig> | null;
    if (saved) Object.assign(config, saved);
  } catch { /* no storage; the default look it is */ }

  const uniforms = {
    uToonK: { value: 0 },
    uToonN: { value: 3 },
    uToonSoft: { value: 0.06 },
    uToonFloor: { value: 0.42 },
    uRim: { value: 0.3 },
    uRimP: { value: 3.2 },
    uRimCol: { value: new THREE.Color(DEFAULT_TOON.rimColor) },
    uGlow: { value: 0 },
    uEmissive: { value: 1 },
    uSat: { value: 1 },
  };

  /* Patched into the standard material rather than replacing it with
     MeshToonMaterial, which would throw away his normal map, his roughness and
     the environment probe he is matched to the room with — and would have to be
     swapped back rather than turned down. */
  for (const material of colin.materials) {
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.fragmentShader =
        'uniform float uToonK, uToonN, uToonSoft, uToonFloor, uRim, uRimP, uGlow, uEmissive, uSat;\n'
        + 'uniform vec3 uRimCol;\n'
        + 'float toonRamp(float x){\n'
        + '  float s = x * uToonN, b = floor(s), f = s - b;\n'
        + '  float q = (b + smoothstep(0.5 - uToonSoft, 0.5 + uToonSoft, f)) / uToonN;\n'
        + '  q = uToonFloor + (1.0 - uToonFloor) * q;\n'
        + '  return mix(x, q, uToonK);\n}\n'
        + shader.fragmentShader
          /* One line inside RE_Direct_Physical, checked against the pinned copy
             in node_modules: `irradiance` is dotNL × the light's colour and is
             shared with the specular term, so the diffuse gets its own ramped
             copy and the specular is left alone. */
          .replace('#include <lights_physical_pars_fragment>',
            THREE.ShaderChunk.lights_physical_pars_fragment.replace(
              'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution );',
              'reflectedLight.directDiffuse += ( toonRamp( dotNL ) * directLight.color )'
              + ' * BRDF_Lambert( material.diffuseContribution );'))
          /* After the lights, before the emissive is folded in: the rim is a lit
             edge and the glow is the texture emitting a little of itself, which
             is what makes a flat colour look like it is giving off light rather
             than catching it. */
          .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      {
        totalEmissiveRadiance *= mix( 1.0, uEmissive, uToonK );
        float _rf = 1.0 - saturate( dot( geometryNormal, geometryViewDir ) );
        totalEmissiveRadiance += uRimCol * ( pow( _rf, uRimP ) * uRim * uToonK );
        totalEmissiveRadiance += diffuseColor.rgb * ( uGlow * uToonK );
      }`)
          /* Saturation, in linear light and BEFORE the tone curve — which is the
             only place it belongs. Applied afterwards it fights the curve's own
             desaturation of the highlights and turns the bright end plastic;
             applied here it is a property of the material, the way it would be
             if the texture had been painted that way. */
          .replace('#include <tonemapping_fragment>',
            'gl_FragColor.rgb = mix( vec3( dot( gl_FragColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) ),'
            + ' gl_FragColor.rgb, uSat );\n#include <tonemapping_fragment>');
    };
    /* WITHOUT THIS THE PATCH REACHES HALF OF HIM. three builds a program cache
       key out of a material's parameters and nothing else — `onBeforeCompile` is
       not in it — so two materials with the same parameters share one compiled
       program and whichever compiled first decides for both. His skin and the
       room's plaster can collide exactly that way. */
    material.customProgramCacheKey = () => 'colin-toon';
    material.needsUpdate = true;
  }

  /* ---- the ink line ----
     A back-facing copy of him, one size up. The cheap trick, and still the right
     one here: no second render pass, no depth buffer to sample, and it follows
     the skeleton and the blend shapes for free because it IS the same geometry
     bound to the same skeleton.
     Its one real limitation is visible on his hair: a hull pushed along the
     normals opens up wherever the normals are SPLIT, so a low-poly shape with
     hard edges gets a faceted line rather than a smooth one. The fixes are a
     normal-smoothed copy of the geometry or a screen-space edge pass, and
     neither is worth building until the look itself is chosen. */
  const outlineUniforms = {
    uOutline: { value: 0 },
    uOutlineCol: { value: new THREE.Color(DEFAULT_TOON.outlineColor) },
  };
  const outlines: THREE.Mesh[] = [];

  /* Collected first, built second. Adding a mesh to the tree from inside
     `traverse` hands the traversal its own new child, and the hull would be
     given a hull. */
  const wearers: THREE.Mesh[] = [];
  colin.model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh && !(o as THREE.SkinnedMesh).isSkinnedMesh) return;
    if (mesh.name === 'ContactShadow') return;
    if (NO_OUTLINE.includes(mesh.name.toLowerCase())) return;
    wearers.push(mesh);
  });

  for (const mesh of wearers) {
    const material = new THREE.MeshBasicMaterial({
      color: 0x241c16,
      // The whole trick: draw only the faces pointing away, pushed outward, so
      // what survives is the sliver that pokes out past his silhouette.
      side: THREE.BackSide,
      toneMapped: false,
      fog: false,
    });
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, outlineUniforms);
      shader.vertexShader = 'uniform float uOutline;\n' + shader.vertexShader
        .replace('#include <project_vertex>', `
        vec4 mvPosition = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        mvPosition = modelViewMatrix * mvPosition;
        /* Scaled by view depth, so the line is a constant thickness ON SCREEN.
           Pushed in view space rather than object space so a non-uniform scale
           anywhere up the hierarchy cannot make one side thicker than the
           other — and he is uniformly scaled to a fitted height, which is
           exactly such a scale. */
        mvPosition.xyz += normalize( normalMatrix * objectNormal ) * ( uOutline * -mvPosition.z );
        gl_Position = projectionMatrix * mvPosition;`);
      shader.fragmentShader = 'uniform vec3 uOutlineCol;\n' + shader.fragmentShader
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );',
          'vec4 diffuseColor = vec4( uOutlineCol, opacity );');
    };
    material.customProgramCacheKey = () => 'colin-outline';

    const skinned = mesh as THREE.SkinnedMesh;
    let shell: THREE.Mesh;
    if (skinned.isSkinnedMesh) {
      const hull = new THREE.SkinnedMesh(mesh.geometry, material);
      // The same skeleton, not a copy: the hull has to be posed by whatever is
      // posing him, every frame, including the blend shapes on his face.
      hull.bind(skinned.skeleton, skinned.bindMatrix);
      shell = hull;
    } else {
      shell = new THREE.Mesh(mesh.geometry, material);
    }
    shell.name = `${mesh.name}_Outline`;
    shell.morphTargetInfluences = mesh.morphTargetInfluences;
    shell.morphTargetDictionary = mesh.morphTargetDictionary;
    shell.frustumCulled = false;
    shell.renderOrder = -1;
    shell.visible = false;
    mesh.parent?.add(shell);
    outlines.push(shell);
  }

  /** The cap, as the fraction of the material's current emission that survives.
   *  1 when the room is already below the ceiling, which a studio always is. */
  const capEmissive = () => {
    const now = colin.materials[0]?.emissiveIntensity ?? 1;
    uniforms.uEmissive.value = now > 0 ? Math.min(1, config.emissiveMax / now) : 1;
  };

  const apply = () => {
    const k = THREE.MathUtils.clamp(config.amount, 0, 1);
    uniforms.uToonK.value = k;
    uniforms.uToonN.value = Math.max(1, Math.round(config.bands));
    uniforms.uToonSoft.value = Math.max(0.001, config.soft);
    uniforms.uToonFloor.value = THREE.MathUtils.clamp(config.floor, 0, 0.95);
    uniforms.uRim.value = config.rim;
    uniforms.uRimP.value = Math.max(0.1, config.rimPower);
    uniforms.uRimCol.value.set(config.rimColor);
    uniforms.uGlow.value = Math.max(0, config.glow);
    capEmissive();

    /* Roughly pixels at 1080p. The shader multiplies by view depth, so this is
       a half-angle rather than a length — dividing by the viewport height is
       what turns "2 px" into one. */
    const thickness = (config.outline / 1080) * k;
    outlineUniforms.uOutline.value = thickness;
    outlineUniforms.uOutlineCol.value.set(config.outlineColor);
    for (const shell of outlines) shell.visible = thickness > 0;

    try { localStorage.setItem(KEY, JSON.stringify(config)); }
    catch { /* nothing to do; it lasts the session */ }
  };

  apply();
  return {
    config,
    apply,
    setGrade: (grade) => { uniforms.uSat.value = Math.max(0, grade.saturation); },
    update: capEmissive,
    get on() { return config.amount > 0; },
  };
}
