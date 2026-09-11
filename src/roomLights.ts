// An experiment: light the kitchen with real lights instead of the baked
// lightmaps, and see what the albedo and normal maps do on their own.
//
// The bake will almost certainly win on quality — it is path-traced GI with
// hours of Blender behind it, against four lights and a shadow map. What it
// cannot do is change: the lightmaps are a photograph of one lighting state, so
// a light switch, a time of day, or a lamp the character turns on all need a
// second bake. This is the other end of that trade, wired up so the two can be
// compared with a toggle rather than a rebuild.
//
// Nothing here is destructive. The lightmaps stay attached to the materials;
// they are only turned down to zero, so flipping back is one assignment.
import * as THREE from 'three';

export interface RoomLightConfig {
  /** Lights on, lightmaps off. */
  enabled: boolean;
  /** Sky and bounce, which is what the bake's ambient term was doing. */
  ambient: number;
  /** Daylight through the window. */
  sun: number;
  /** Degrees around Y, 0 = from the camera, negative = from the left. */
  sunAzimuthDeg: number;
  /** Degrees above the horizon. */
  sunElevationDeg: number;
  /** The pendant over the table — there is a real bulb in the GLB at this spot. */
  bulb: number;
  /** A soft wash from the camera, standing in for the bounce off the fourth wall
   *  that a room with only one light source never gets. */
  fill: number;
  /** Shadow map on the sun. The expensive part, hence a switch. */
  shadows: boolean;
  /** How much the HDR probe contributes. The bake had this at 0.25, since the
   *  lightmaps already carried the ambient; without them it has to do more. */
  envMapIntensity: number;
}

/* Tuned against the bake rather than invented: rendered side by side, the first
   attempt came out cooler and harder than the baked room, because four lights
   have no bounce and the bake is nothing but bounce. The fix is to stop asking
   the lights to do it. The HDR probe was shot INSIDE this kitchen, so it already
   carries the warm walls, the colour bleeding off the wood, and the soft
   wrap — turn it most of the way up and it stands in for the GI, leaving the
   lights to do only the part they are good at: direction and the bulb. */
export const DEFAULT_ROOM_LIGHTS: RoomLightConfig = {
  enabled: false,
  ambient: 0.2,
  sun: 1.6,
  sunAzimuthDeg: -48,
  sunElevationDeg: 34,
  bulb: 10,
  fill: 0.2,
  shadows: true,
  envMapIntensity: 1.7,
};

/** Where the pendant's bulb actually is, measured off `Pendant_Lamp_1`. */
const BULB = new THREE.Vector3(-1.55, 2.25, 2.55);
/** Roughly the middle of the floor, which is what the sun aims at. */
const ROOM_CENTRE = new THREE.Vector3(-0.4, 0.9, 1.8);

export interface RoomLights {
  group: THREE.Group;
  config: RoomLightConfig;
  /** Push the config onto the lights and the materials. Call after any change. */
  apply: () => void;
}

/**
 * @param lightmapped every room material carrying a lightmap, so they can be
 *   turned down together. Their `lightMapIntensity` is captured once here, which
 *   is what "off" restores to.
 */
export function createRoomLights(
  renderer: THREE.WebGLRenderer,
  room: THREE.Object3D,
  lightmapped: THREE.MeshStandardMaterial[],
  config: RoomLightConfig = { ...DEFAULT_ROOM_LIGHTS },
): RoomLights {
  const group = new THREE.Group();
  group.name = 'RoomLights';

  // Sky above, warm floor bounce below. A plain AmbientLight would flatten every
  // upward face against every downward one, which is exactly the look that gives
  // "we turned the lightmaps off" away.
  // Warm, not the usual blue sky: this is a lamp-lit room with wood in it, and a
  // cool ambient fought the bake's warmth harder than anything else did.
  const sky = new THREE.HemisphereLight(0xffe4c4, 0xe2c49c, 1);
  group.add(sky);

  const sun = new THREE.DirectionalLight(0xfff0d8, 1);
  sun.target.position.copy(ROOM_CENTRE);
  group.add(sun, sun.target);

  /* The bulb is a real object in the GLB with an emissive material on it, so the
     light goes exactly where the glow already is rather than somewhere that
     looks about right. Physical falloff, because a room lit by an inverse-square
     lamp is most of what reads as indoors. */
  const bulb = new THREE.PointLight(0xffd6a0, 1, 0, 2);
  bulb.position.copy(BULB);
  group.add(bulb);

  // The fourth wall is behind the camera and is not in the GLB, so nothing
  // bounces off it. This is that bounce.
  const fill = new THREE.DirectionalLight(0xffffff, 1);
  fill.position.set(-0.36, 2.0, 5.4);
  fill.target.position.copy(ROOM_CENTRE);
  group.add(fill, fill.target);

  const bakedIntensity = lightmapped.map((m) => m.lightMapIntensity);
  const bakedEnv = lightmapped.map((m) => m.envMapIntensity);

  let shadowsReady = false;
  const prepareShadows = () => {
    if (shadowsReady) return;
    shadowsReady = true;
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const c = sun.shadow.camera;
    // The room is about 9 m across; frame the part anything stands in.
    c.left = -5; c.right = 5; c.top = 5; c.bottom = -5; c.near = 0.5; c.far = 22;
    c.updateProjectionMatrix();
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.02;
    room.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
  };

  const apply = () => {
    const on = config.enabled;
    group.visible = on;

    for (let i = 0; i < lightmapped.length; i++) {
      // Turned down, never detached: the bake is one assignment away again.
      lightmapped[i].lightMapIntensity = on ? 0 : bakedIntensity[i];
      lightmapped[i].envMapIntensity = on ? config.envMapIntensity : bakedEnv[i];
    }

    sky.intensity = config.ambient;
    sun.intensity = config.sun;
    bulb.intensity = config.bulb;
    fill.intensity = config.fill;

    const az = THREE.MathUtils.degToRad(config.sunAzimuthDeg);
    const el = THREE.MathUtils.degToRad(config.sunElevationDeg);
    const r = 9;
    sun.position.set(
      ROOM_CENTRE.x + Math.sin(az) * Math.cos(el) * r,
      ROOM_CENTRE.y + Math.sin(el) * r,
      ROOM_CENTRE.z + Math.cos(az) * Math.cos(el) * r,
    );

    if (on && config.shadows) prepareShadows();
    sun.castShadow = on && config.shadows && shadowsReady;
    // Shared with the character pass, so only claim it while this is on.
    renderer.shadowMap.enabled = on && config.shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  };

  apply();
  return { group, config, apply };
}
