// Grafting the blendshape head onto the body.
//
// The body is one mesh with one material and no morph targets; the face with
// the 92 visemes lives in a separate file on a different rig (Character Creator,
// where the body is Mixamo). So the head is hung off the body's head bone and
// the body's own head is discarded in the shader.
//
// Discarded, not hidden or shrunk. There is no separate head mesh to switch off,
// and collapsing the head bone drags every vertex blended into the neck and
// shoulders inward with it — the head goes and a funnel appears where it was.
// Throwing the fragments away leaves the geometry, the skinning and the collar
// exactly as they are.
//
// This is the stopgap arrangement: two files, one of which is mostly wasted.
// A body exported with its head as its own material makes the cut a one-line
// hide instead.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import type { Character } from './character';

export interface HeadFit {
  /** Multiplier on the measured scale, for taste. */
  scale: number;
  /** Metres along the body's head bone, after scaling. The two rigs disagree
   *  about where a head joint belongs — Mixamo puts it at the top of the neck,
   *  Character Creator higher into the skull — so matching them by name alone
   *  sits his chin on his collar. */
  offsetY: number;
  offsetZ: number;
  /** Degrees, after the rest-pose correction. Pitch is the one that matters. */
  pitchDeg: number;
  yawDeg: number;
  /**
   * Body vertices whose head-bone weight exceeds this are discarded. Below 1 so
   * that vertices only partly bound to the head — the ones blended into the
   * neck — survive and keep the collar intact.
   */
  cut: number;
  /** Log the fitting arithmetic. */
  debug?: boolean;
}

/**
 * `scale` is under 1 because the target is measured from vertices weighted to the
 * head bone, and on this body that includes the hood — which makes the head the
 * graft is replacing look taller than the head actually is.
 */
export const DEFAULT_HEAD_FIT: HeadFit =
  { scale: 0.78, offsetY: 0.02, offsetZ: 0, pitchDeg: 0, yawDeg: 0, cut: 0.9, debug: false };

export interface GraftedHead {
  model: THREE.Object3D;
  /** Every skinned mesh of the face that carries morph targets. */
  meshes: THREE.SkinnedMesh[];
  /** Viseme name → influence index, e.g. V_Open, V_Explosive, V_Tight_O. */
  morphs: Record<string, number>;
  /** Set one blendshape by name, 0..1. Unknown names are ignored. */
  setMorph: (name: string, value: number) => void;
  /** Return every blendshape to rest. */
  clearMorphs: () => void;
  fit: HeadFit;
  /** Re-apply fit after changing it. */
  apply: () => void;
  measuredScale: number;
}

/**
 * World bounds of a skinned subtree.
 *
 * `Box3.setFromObject` is wrong here: a skinned mesh's stored positions are in
 * bind space, and the shader puts them where they belong with the bone matrices,
 * not with `matrixWorld`. Measuring the raw positions gave a body 2 cm tall —
 * out by exactly the armature's centimetre scale, which the inverse bind
 * matrices have already accounted for. `applyBoneTransform` is the same
 * arithmetic the shader does.
 */
function skinnedWorldBox(root: THREE.Object3D, keep?: (mesh: THREE.SkinnedMesh, i: number) => boolean) {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  let found = false;
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isMesh) return;
    const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!position) return;
    for (let i = 0; i < position.count; i++) {
      if (keep && !keep(mesh, i)) continue;
      v.fromBufferAttribute(position, i);
      if (mesh.isSkinnedMesh) mesh.applyBoneTransform(i, v);
      v.applyMatrix4(mesh.matrixWorld);
      box.expandByPoint(v);
      found = true;
    }
  });
  return found ? box : null;
}

/**
 * World bounds of the head we are about to throw away.
 *
 * This is the only measurement worth fitting to. The bone span is no use — the
 * Mixamo head joint sits 9 cm below the crown on a figure whose visible head is
 * several times that — and the head file's own numbers are in its own units
 * under a bone chain whose world scale is 0.0038. The vertices actually bound
 * to the head bone are the head, at the size it is on screen.
 */
function bodyHeadBounds(character: Character, cut: number): THREE.Box3 | null {
  return skinnedWorldBox(character.model, (mesh, i) => {
    const weights = mesh.geometry.getAttribute('headW');
    return !!weights && weights.getX(i) > cut;
  });
}

function findBone(root: THREE.Object3D, re: RegExp): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  root.traverse((o) => { if (!found && re.test(o.name)) found = o; });
  return found;
}

/**
 * Hide the body's head by discarding its fragments.
 *
 * `headW` is how much of each vertex belongs to the head bone, summed from the
 * skin weights. It has to be computed before the material compiles, since the
 * attribute is declared in the shader.
 */
export function cutBodyHead(character: Character, cut: number) {
  character.model.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;

    const geometry = mesh.geometry;
    if (!geometry.getAttribute('headW')) {
      const skeleton = mesh.skeleton;
      let headIndex = -1;
      skeleton?.bones.forEach((b, i) => { if (/(^|[_:])Head$/i.test(b.name)) headIndex = i; });

      const index = geometry.attributes.skinIndex;
      const weight = geometry.attributes.skinWeight;
      const position = geometry.attributes.position;
      const weights = new Float32Array(position.count);
      if (headIndex >= 0 && index && weight) {
        for (let v = 0; v < position.count; v++) {
          let total = 0;
          for (let k = 0; k < 4; k++) {
            if (index.getComponent(v, k) === headIndex) total += weight.getComponent(v, k);
          }
          weights[v] = total;
        }
      }
      geometry.setAttribute('headW', new THREE.BufferAttribute(weights, 1));
    }

    for (const material of [].concat(mesh.material as never) as THREE.Material[]) {
      const uniform = { value: cut };
      material.userData.headCut = uniform;
      material.onBeforeCompile = (shader) => {
        shader.uniforms.uHeadCut = uniform;
        shader.vertexShader = 'attribute float headW;\nvarying float vHeadW;\n' +
          shader.vertexShader.replace('#include <begin_vertex>',
            '#include <begin_vertex>\n  vHeadW = headW;');
        shader.fragmentShader = 'varying float vHeadW;\nuniform float uHeadCut;\n' +
          shader.fragmentShader.replace('void main() {',
            'void main() {\n  if (vHeadW > uHeadCut) discard;');
      };
      material.needsUpdate = true;
    }
  });
}

export interface GraftHeadOptions {
  fit?: HeadFit;
  /**
   * Textures keyed by material name. The head file carries none of its own —
   * `colin_head.glb` has four materials and zero images — so without this it
   * renders as blank skin with no hair and no eyes.
   */
  skins?: Record<string, string>;
  envMap?: THREE.Texture;
  envMapIntensity?: number;
  emissiveIntensity?: number;
  roughness?: number;
  renderer?: THREE.WebGLRenderer;
}

export async function graftHead(
  character: Character,
  url: string,
  {
    fit = { ...DEFAULT_HEAD_FIT }, skins, envMap, envMapIntensity = 1,
    emissiveIntensity = 0, roughness, renderer,
  }: GraftHeadOptions = {},
): Promise<GraftedHead> {
  const loader = new GLTFLoader().setDRACOLoader(new DRACOLoader());
  const ktx2 = renderer ? new KTX2Loader().detectSupport(renderer) : null;
  if (ktx2) loader.setKTX2Loader(ktx2);
  const gltf = await loader.loadAsync(url);
  ktx2?.dispose();
  const model = gltf.scene;

  const bodyHead = findBone(character.model, /(^|[_:])Head$/i);
  if (!bodyHead) throw new Error('No head bone on the body to graft onto');

  // Weights first: the fit is measured from them, and the cut needs them anyway.
  cutBodyHead(character, fit.cut);

  const anchor = new THREE.Group();
  anchor.name = 'HeadGraft';
  anchor.add(model);
  bodyHead.add(anchor);

  // Load the face textures before touching materials, so emission can be wired
  // to the map that actually ends up on them.
  const loaded: Record<string, THREE.Texture> = {};
  if (skins) {
    const texLoader = new THREE.TextureLoader();
    await Promise.all(Object.entries(skins).map(async ([material, file]) => {
      const t = await texLoader.loadAsync(file);
      t.flipY = false;                    // glTF UV convention
      t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
      loaded[material] = t;
    }));
  }

  const meshes: THREE.SkinnedMesh[] = [];
  const morphs: Record<string, number> = {};
  model.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isMesh) return;
    mesh.frustumCulled = false;
    if (mesh.morphTargetDictionary) {
      meshes.push(mesh);
      Object.assign(morphs, mesh.morphTargetDictionary);
    }
    for (const m of [].concat(mesh.material as never) as THREE.Material[]) {
      const std = m as THREE.MeshStandardMaterial;
      if (!std.isMeshStandardMaterial) continue;
      const skin = loaded[std.name];
      if (skin) {
        std.map = skin;
        // Black base colour times any map is still black.
        std.color.setScalar(1);
      }
      if (envMap) std.envMap = envMap;
      std.envMapIntensity = envMapIntensity;
      if (roughness !== undefined) std.roughness = roughness;
      // Same trick the body uses: emission survives AgX where lighting does not.
      if (emissiveIntensity > 0 && std.map) {
        std.emissiveMap = std.map;
        std.emissive.setScalar(1);
        std.emissiveIntensity = emissiveIntensity;
      }
      std.needsUpdate = true;
    }
  });

  /**
   * Solve the fit by measuring rather than deriving it.
   *
   * Everything here sits under a bone whose world scale is 0.0038, and the head
   * file is in its own units on top of that — two unit systems to get wrong. So
   * set a scale, look at what came out in world space, and correct. Two passes
   * converge exactly, because scaling is linear.
   */
  const solve = () => {
    // Everything is measured in one pass, in the pose he is actually rendered
    // in. Measuring the target in one pose and fitting to it in another put the
    // head behind his shoulder; measuring in the bind pose instead put the scale
    // out by the armature's 100x centimetre factor, which Skeleton.pose()
    // restores and the animated pose does not have.
    // setTime, not update(0): the fit is measured from his pose, so measuring at
    // "whatever frame the load happened to reach" made the head come out a
    // different size on mobile than on desktop. Frame 0 of the current clip is
    // the same everywhere.
    character.mixer.setTime(0);
    character.root.updateWorldMatrix(true, true);
    const targetBox = bodyHeadBounds(character, fit.cut);
    if (!targetBox) return;

    const wantHeight = (targetBox.max.y - targetBox.min.y) * fit.scale;

    // The head bone carries the Mixamo rig's own rest rotation, which the
    // Character Creator head knows nothing about — inherited, it tips his head
    // down and to one side. Cancelling the bone's rest orientation leaves the
    // head upright while still following the bone when it animates.
    const rest = bodyHead.getWorldQuaternion(new THREE.Quaternion()).invert();
    anchor.quaternion.copy(rest).multiply(
      new THREE.Quaternion().setFromEuler(new THREE.Euler(
        THREE.MathUtils.degToRad(fit.pitchDeg), THREE.MathUtils.degToRad(fit.yawDeg), 0, 'YXZ')),
    );
    anchor.scale.setScalar(1);
    anchor.position.set(0, 0, 0);
    model.position.set(0, 0, 0);
    anchor.updateWorldMatrix(true, true);
    const unit = skinnedWorldBox(model);
    if (!unit) return;
    const unitHeight = unit.max.y - unit.min.y;
    if (unitHeight < 1e-9) return;

    anchor.scale.setScalar(wantHeight / unitHeight);
    anchor.updateWorldMatrix(true, true);
    if (fit.debug) {
      console.log('[graft] target head world box', targetBox.min.toArray().map((v) => +v.toFixed(3)),
        targetBox.max.toArray().map((v) => +v.toFixed(3)), 'height', +wantHeight.toFixed(3));
      console.log('[graft] head at scale 1 world box', unit.min.toArray().map((v) => +v.toFixed(4)),
        unit.max.toArray().map((v) => +v.toFixed(4)), 'height', +unitHeight.toFixed(4));
      console.log('[graft] anchor scale ->', +(wantHeight / unitHeight).toFixed(4));
    }

    // Align by the crown, not the chin. The head bone's weights run down into
    // the neck, so the bottom of the target box is somewhere in his throat and
    // varies with the cut; the top of the skull is the top of the skull.
    const placed = skinnedWorldBox(model);
    if (!placed) return;
    if (fit.debug) console.log('[graft] after scaling, world box', placed.min.toArray().map((v) => +v.toFixed(3)), placed.max.toArray().map((v) => +v.toFixed(3)));
    const delta = new THREE.Vector3(
      targetBox.getCenter(new THREE.Vector3()).x - placed.getCenter(new THREE.Vector3()).x,
      targetBox.max.y - placed.max.y + fit.offsetY,
      targetBox.getCenter(new THREE.Vector3()).z - placed.getCenter(new THREE.Vector3()).z + fit.offsetZ,
    );
    // Convert through the bone's full inverse matrix rather than by rotating and
    // dividing by one scale factor: the chain above this bone is not uniformly
    // scaled, and treating it as if it were left the head beside his ear.
    const anchorWorld = anchor.getWorldPosition(new THREE.Vector3());
    anchor.position.copy(bodyHead.worldToLocal(anchorWorld.clone().add(delta)));
    anchor.updateWorldMatrix(true, true);
    if (fit.debug) {
      const final = skinnedWorldBox(model);
      console.log('[graft] delta', delta.toArray().map((v) => +v.toFixed(3)),
        'anchor world before', anchorWorld.toArray().map((v) => +v.toFixed(3)),
        'anchor local ->', anchor.position.toArray().map((v) => +v.toFixed(2)));
      console.log('[graft] FINAL head box', final?.min.toArray().map((v) => +v.toFixed(3)),
        final?.max.toArray().map((v) => +v.toFixed(3)));
      console.log('[graft] wanted        ', targetBox.min.toArray().map((v) => +v.toFixed(3)),
        targetBox.max.toArray().map((v) => +v.toFixed(3)));
    }
  };
  const apply = solve;
  solve();

  const setMorph = (name: string, value: number) => {
    const i = morphs[name];
    if (i === undefined) return;
    for (const mesh of meshes) if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[i] = value;
  };
  const clearMorphs = () => {
    for (const mesh of meshes) mesh.morphTargetInfluences?.fill(0);
  };

  // A getter, not a snapshot: the solve reruns on every fit change.
  return {
    model, meshes, morphs, setMorph, clearMorphs, fit, apply,
    get measuredScale() { return anchor.scale.y; },
  };
}
