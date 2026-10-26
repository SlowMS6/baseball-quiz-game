// 3D ballpark: renders the batter, pitcher, and pitch, and times the
// player's swing. Hit-quality math stays in rules.ts (classifySwing) —
// this file owns the scene, the animation, and the pitch clock.
//
// Both players are clones of "Cesium Man" (CC BY 4.0). The model ships with
// a walk cycle only, so baseball poses are built here: keyframed body
// offsets, solved onto the skeleton each frame with aim + two-bone IK. That
// keeps every pose readable as numbers, independent of how each bone's
// local axes happen to be oriented.

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { HitType, Outcome } from "./rules";

const MODEL_URL = `${import.meta.env.BASE_URL}models/CesiumMan.glb`;
const PLAYER_HEIGHT = 1.8; // meters

// Pitch clock. The ball passes through the glowing hit-zone ring at phase
// 0.5 (a perfect swing, see classifySwing) and the bat meets it CONTACT_MS
// later at the plate, so a perfectly timed swing connects on screen.
const WINDUP_MS = 900;
const CONTACT_MS = 128;
const SWING_TOTAL_MS = 1300;
const PITCH_FOLLOW_MS = 1500;

const UP = new THREE.Vector3(0, 1, 0);
const MOUND = new THREE.Vector3(0, 0.25, -12.5);
const BATTER_SPOT = new THREE.Vector3(-0.8, 0, 0.12);
const BASE_DIST = 19;
const WALL_RADIUS = 60;
const CAMERA_POS = new THREE.Vector3(0.35, 1.85, 6.3);
const CAMERA_TARGET = new THREE.Vector3(0, 1.15, -10);
const CAMERA_FOV = 29;

const BAT_LEN = 0.86;
const KNOB_TO_GRIP = 0.08;
const SWEET_SPOT = BAT_LEN - KNOB_TO_GRIP - 0.16; // from the grip
const BALL_RADIUS = 0.06;

interface Kit {
  jersey: number;
  pants: number;
  socks: number;
  belt: number;
  shoes: number;
  skin: number;
  hat: number;
}

const KITS: Record<"you" | "cpu", Kit> = {
  you: { jersey: 0x1e6fd9, pants: 0xf5f2ea, socks: 0x1e6fd9, belt: 0x14213d, shoes: 0x1d2433, skin: 0xf1c27d, hat: 0x1452a6 },
  cpu: { jersey: 0xe53935, pants: 0xf5f2ea, socks: 0xe53935, belt: 0x14213d, shoes: 0x1d2433, skin: 0xa8693f, hat: 0xb3201e },
};

// ---------- Poses ----------

type V3 = [number, number, number]; // [right, up, forward] in model units (~0.83 m)

interface Pose {
  shift: V3; // pelvis offset from its rest spot; feet stay planted
  hip: number; // pelvis turn, radians; + turns toward the player's left
  spine: number; // extra upper-body turn on top of the hips
  lean: number; // forward bend of the upper body
  footL: V3; // ankle offsets from rest, in the body frame
  footR: V3;
  handL: V3; // wrist targets relative to the chest, in the chest frame
  handR: V3; // (batter: the grip on the bat)
  batYaw: number; // batter only: 0 = toward the catcher, π/2 = across the plate
  batPitch: number; // batter only: bat elevation
}

const REST: Pose = {
  shift: [0, 0, 0],
  hip: 0,
  spine: 0,
  lean: 0,
  footL: [0, 0, 0],
  footR: [0, 0, 0],
  handL: [0, 0, 0],
  handR: [0, 0, 0],
  batYaw: 0,
  batPitch: 0,
};
const pose = (p: Partial<Pose>): Pose => ({ ...REST, ...p });

type Ease = (t: number) => number;
const smooth: Ease = (t) => t * t * (3 - 2 * t);
const easeIn: Ease = (t) => t * t;
const easeOut: Ease = (t) => 1 - (1 - t) * (1 - t);
type Key = [ms: number, pose: Pose, ease?: Ease];

const BATTER_STANCE = pose({
  shift: [0.02, -0.07, 0],
  spine: -0.3,
  lean: 0.2,
  footL: [-0.14, 0, 0.02],
  footR: [0.08, 0, 0],
  handR: [0.13, 0.1, 0.17],
  batYaw: -0.35,
  batPitch: 1.0,
});

const BATTER_CONTACT = pose({
  shift: [-0.07, -0.09, 0.02],
  hip: 0.85,
  spine: 0.1,
  lean: 0.28,
  footL: [-0.2, 0, 0.03],
  footR: [0.08, 0, 0],
  handR: [-0.03, -0.2, 0.27],
  batYaw: Math.PI / 2,
  batPitch: -0.06,
});

const BATTER_FINISH = pose({
  shift: [-0.09, -0.06, 0.02],
  hip: 1.25,
  spine: 0.45,
  lean: 0.12,
  footL: [-0.2, 0, 0.03],
  footR: [0.06, 0.04, 0.02],
  handR: [-0.17, 0.12, 0.1],
  batYaw: 4.1,
  batPitch: 0.65,
});

// Swing timeline in ms from the moment the player swings.
const BATTER_SWING: Key[] = [
  [0, BATTER_STANCE],
  [55, pose({ ...BATTER_STANCE, spine: -0.42, footL: [-0.2, 0.05, 0.03] }), easeOut],
  [CONTACT_MS, BATTER_CONTACT, easeIn],
  [320, BATTER_FINISH, easeOut],
  [750, BATTER_FINISH],
  [SWING_TOTAL_MS, BATTER_STANCE],
];

const PITCHER_SET = pose({
  shift: [0, -0.02, 0],
  lean: 0.05,
  footL: [-0.02, 0, 0],
  footR: [0.02, 0, 0],
  handL: [-0.03, -0.13, 0.17],
  handR: [0.03, -0.13, 0.17],
});

// Throw timeline in ms relative to the release of the ball.
const PITCHER_THROW: Key[] = [
  [-WINDUP_MS, PITCHER_SET],
  [-620, pose({ hip: -0.75, spine: -0.1, lean: -0.05, footL: [0.04, 0.3, 0.12], footR: [0.02, 0, 0], handL: [0, -0.02, 0.18], handR: [0.03, -0.02, 0.18] })],
  [-300, pose({ shift: [0, -0.06, 0.06], hip: -0.6, spine: -0.2, lean: -0.08, footL: [-0.04, 0.12, 0.36], handL: [-0.24, 0.02, 0.2], handR: [0.3, 0.12, -0.22] })],
  [-90, pose({ shift: [0, -0.1, 0.16], hip: -0.1, spine: 0.1, lean: 0.15, footL: [-0.06, 0, 0.5], handL: [-0.2, -0.05, 0.18], handR: [0.27, 0.3, -0.1] })],
  [0, pose({ shift: [0, -0.12, 0.24], hip: 0.45, spine: 0.3, lean: 0.4, footL: [-0.06, 0, 0.5], handL: [-0.15, -0.15, 0.08], handR: [0.1, 0.24, 0.3] }), easeIn],
  [260, pose({ shift: [0, -0.12, 0.3], hip: 0.8, spine: 0.35, lean: 0.62, footL: [-0.06, 0, 0.5], footR: [0, 0.16, -0.04], handL: [-0.15, -0.2, 0], handR: [-0.22, -0.32, 0.17] }), easeOut],
  [800, pose({ shift: [0, -0.06, 0.2], hip: 0.4, spine: 0.1, lean: 0.25, footL: [-0.06, 0, 0.5], footR: [0.04, 0, 0.32], handL: [-0.08, -0.15, 0.15], handR: [0.04, -0.15, 0.15] })],
  [PITCH_FOLLOW_MS, PITCHER_SET],
];

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mix3 = (a: V3, b: V3, t: number): V3 => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

function lerpPose(a: Pose, b: Pose, t: number): Pose {
  return {
    shift: mix3(a.shift, b.shift, t),
    hip: mix(a.hip, b.hip, t),
    spine: mix(a.spine, b.spine, t),
    lean: mix(a.lean, b.lean, t),
    footL: mix3(a.footL, b.footL, t),
    footR: mix3(a.footR, b.footR, t),
    handL: mix3(a.handL, b.handL, t),
    handR: mix3(a.handR, b.handR, t),
    batYaw: mix(a.batYaw, b.batYaw, t),
    batPitch: mix(a.batPitch, b.batPitch, t),
  };
}

function sampleKeys(keys: Key[], ms: number): Pose {
  if (ms <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, p1, ease = smooth] = keys[i];
    if (ms < t1) {
      const [t0, p0] = keys[i - 1];
      return lerpPose(p0, p1, ease((ms - t0) / (t1 - t0)));
    }
  }
  return keys[keys.length - 1][1];
}

// ---------- Rig: aim + two-bone IK on a Cesium Man clone ----------

const BONES = {
  pelvis: "Skeleton_torso_joint_1",
  spine: "Skeleton_torso_joint_2",
  chest: "torso_joint_3",
  neck: "Skeleton_neck_joint_1",
  head: "Skeleton_neck_joint_2",
  shoulderR: "Skeleton_arm_joint_R",
  elbowR: "Skeleton_arm_joint_R__2_",
  wristR: "Skeleton_arm_joint_R__3_",
  shoulderL: "Skeleton_arm_joint_L__4_",
  elbowL: "Skeleton_arm_joint_L__3_",
  wristL: "Skeleton_arm_joint_L__2_",
  hipR: "leg_joint_R_1",
  kneeR: "leg_joint_R_2",
  ankleR: "leg_joint_R_3",
  toeR: "leg_joint_R_5",
  hipL: "leg_joint_L_1",
  kneeL: "leg_joint_L_2",
  ankleL: "leg_joint_L_3",
  toeL: "leg_joint_L_5",
} as const;
type BoneKey = keyof typeof BONES;
type Side = "L" | "R";

const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();
const qc = new THREE.Quaternion();
const qd = new THREE.Quaternion();
const va = new THREE.Vector3();
const vb = new THREE.Vector3();
const vc = new THREE.Vector3();

// Rotates a bone by a world-space rotation, keeping its children attached.
function rotateWorld(bone: THREE.Object3D, delta: THREE.Quaternion) {
  const world = bone.getWorldQuaternion(qa);
  const parentInv = bone.parent!.getWorldQuaternion(qb).invert();
  bone.quaternion.copy(parentInv.multiply(qc.copy(delta).multiply(world)));
  bone.updateMatrixWorld(true);
}

// Turns `bone` so the segment toward `child` points along `dir` (world).
function aim(bone: THREE.Object3D, child: THREE.Object3D, dir: THREE.Vector3) {
  const from = child.getWorldPosition(va).sub(bone.getWorldPosition(vb)).normalize();
  rotateWorld(bone, qd.setFromUnitVectors(from, vc.copy(dir).normalize()));
}

// Bends a limb (a -> b -> c) so c reaches `target`, with b toward `pole`.
function ik(a: THREE.Object3D, b: THREE.Object3D, c: THREE.Object3D, target: THREE.Vector3, pole: THREE.Vector3) {
  const A = a.getWorldPosition(new THREE.Vector3());
  const l1 = A.distanceTo(b.getWorldPosition(new THREE.Vector3()));
  const l2 = b.getWorldPosition(new THREE.Vector3()).distanceTo(c.getWorldPosition(new THREE.Vector3()));
  const n = target.clone().sub(A);
  const d = THREE.MathUtils.clamp(n.length(), Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
  n.normalize();
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const m = pole.clone().addScaledVector(n, -pole.dot(n)).normalize();
  const joint = A.clone().addScaledVector(n, x).addScaledVector(m, h);
  aim(a, b, joint.clone().sub(A));
  const end = A.addScaledVector(n, d);
  aim(b, c, end.sub(b.getWorldPosition(new THREE.Vector3())));
}

const toonRamp = (() => {
  const tex = new THREE.DataTexture(new Uint8Array([120, 195, 255]), 3, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
})();

const toon = (color: number) => new THREE.MeshToonMaterial({ color, gradientMap: toonRamp });

// Paints a uniform onto the model by bind-pose height (the original texture
// is a logo pattern, not clothing). Cut heights come from the skeleton.
function kitMaterial(kit: Kit, cuts: Record<string, number>) {
  const mat = toon(0xffffff);
  const uniforms: Record<string, THREE.IUniform> = {};
  const decls: string[] = [];
  for (const [k, v] of Object.entries(kit)) {
    uniforms[`u_${k}`] = { value: new THREE.Color(v) };
    decls.push(`uniform vec3 u_${k};`);
  }
  for (const [k, v] of Object.entries(cuts)) {
    uniforms[`u_${k}`] = { value: v };
    decls.push(`uniform float u_${k};`);
  }

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vBind;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvBind = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vBind;\n${decls.join("\n")}`)
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        vec3 kit = u_jersey;
        if (vBind.z < u_beltTop) kit = u_belt;
        if (vBind.z < u_beltBottom) kit = u_pants;
        if (vBind.z < u_sockTop) kit = u_socks;
        if (vBind.z < u_shoeTop) kit = u_shoes;
        if (vBind.z > u_neck || abs(vBind.y) > u_wrist) kit = u_skin;
        diffuseColor.rgb = kit;`
      );
  };
  return mat;
}

class Player {
  readonly root: THREE.Object3D;
  private bones = {} as Record<BoneKey, THREE.Object3D>;
  private rest = new Map<THREE.Object3D, THREE.Quaternion>();
  private F = new THREE.Vector3(); // root-local forward
  private R = new THREE.Vector3(); // root-local right
  private ankleRest = { L: new THREE.Vector3(), R: new THREE.Vector3() };
  private footDir = { L: new THREE.Vector3(), R: new THREE.Vector3() };
  private spot = new THREE.Vector3();
  private scale = 1;

  constructor(source: THREE.Object3D, kit: Kit, hat: "helmet" | "cap") {
    this.root = cloneSkinned(source);
    for (const key of Object.keys(BONES) as BoneKey[]) {
      const bone = this.root.getObjectByName(BONES[key]);
      if (!bone) throw new Error(`Player model is missing bone ${BONES[key]}`);
      this.bones[key] = bone;
      this.rest.set(bone, bone.quaternion.clone());
    }

    // Calibrate the body frame from the bind pose: forward is where the
    // toes point, right is forward x up.
    this.root.updateMatrixWorld(true);
    const at = (k: BoneKey) => this.bones[k].getWorldPosition(new THREE.Vector3());
    this.F.subVectors(at("toeL"), at("ankleL")).add(at("toeR")).sub(at("ankleR")).setY(0).normalize();
    this.R.crossVectors(this.F, UP);
    for (const side of ["L", "R"] as const) {
      this.ankleRest[side] = at(`ankle${side}`);
      this.footDir[side] = at(`toe${side}`).sub(at(`ankle${side}`)).normalize();
    }

    const mesh = this.root.getObjectByProperty("isSkinnedMesh", true) as THREE.SkinnedMesh;
    const local = (k: BoneKey) => mesh.worldToLocal(at(k));
    const positions = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const box = new THREE.Box3().setFromBufferAttribute(positions);
    const height = box.max.z - box.min.z;
    const hip = local("hipL").z;
    const neck = local("neck").z + 0.035 * height;
    mesh.material = kitMaterial(kit, {
      neck,
      wrist: Math.abs(local("wristL").y) + 0.012,
      beltTop: hip + 0.075 * height,
      beltBottom: hip + 0.045 * height,
      sockTop: local("kneeL").z - 0.04 * height,
      shoeTop: local("ankleL").z + 0.015 * height,
    });
    mesh.castShadow = true;
    mesh.frustumCulled = false;

    // Measure the head (every vertex above the neck) in the body frame.
    const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
    const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    const v = new THREE.Vector3();
    for (let i = 0; i < positions.count; i++) {
      v.fromBufferAttribute(positions, i);
      if (v.z < neck) continue;
      mesh.localToWorld(v);
      const p = new THREE.Vector3(v.dot(this.R), v.y, v.dot(this.F));
      lo.min(p);
      hi.max(p);
    }
    const mid = lo.clone().add(hi).multiplyScalar(0.5);
    const half = hi.clone().sub(lo).multiplyScalar(0.5);
    const center = new THREE.Vector3().addScaledVector(this.R, mid.x).addScaledVector(UP, mid.y).addScaledVector(this.F, mid.z);
    this.addHeadwear(hat, kit.hat, center, half);
    this.scale = PLAYER_HEIGHT / height;
  }

  // Builds a helmet or cap (plus cartoon eyes) sized to the head, facing
  // +z/up +y before being turned to the body frame and pinned to the head bone.
  private addHeadwear(kind: "helmet" | "cap", color: number, center: THREE.Vector3, half: THREE.Vector3) {
    const group = new THREE.Group();
    const fit = kind === "helmet" ? 1.14 : 1.08;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.56), toon(color));
    dome.scale.set(half.x * fit, half.y * (kind === "helmet" ? 1.02 : 0.9), half.z * fit);
    dome.position.y = half.y * (kind === "helmet" ? 0.12 : 0.22);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 28, 1, false, -Math.PI / 2, Math.PI), toon(color));
    const reach = kind === "helmet" ? 0.28 : 0.55;
    brim.scale.set(half.x * fit, half.y * 0.05, half.z * (fit + reach));
    brim.position.y = dome.position.y - half.y * 0.17;
    const eyes = [-1, 1].map((s) => {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(half.x * 0.12, 12, 10), toon(0x1a1a1a));
      eye.scale.z = 0.6;
      eye.position.set(s * half.x * 0.36, -half.y * 0.18, half.z * 0.98);
      return eye;
    });
    group.add(dome, brim, ...eyes);
    group.traverse((o) => (o.castShadow = true));
    group.position.copy(center);
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.F);
    this.bones.head.attach(group);
  }

  place(position: THREE.Vector3, facing: THREE.Vector3) {
    this.spot.copy(position);
    this.root.position.copy(position);
    this.root.rotation.y = Math.atan2(facing.x, facing.z) - Math.atan2(this.F.x, this.F.z);
    this.root.scale.setScalar(this.scale);
    this.root.updateMatrixWorld(true);
  }

  // World direction for a body-frame vector, turned by `yaw` about the vertical.
  dir(v: V3, yaw = 0): THREE.Vector3 {
    return new THREE.Vector3()
      .addScaledVector(this.R, v[0])
      .addScaledVector(UP, v[1])
      .addScaledVector(this.F, v[2])
      .applyAxisAngle(UP, yaw)
      .applyQuaternion(this.root.quaternion);
  }

  private offset(v: V3, yaw = 0) {
    return this.dir(v, yaw).multiplyScalar(this.scale);
  }

  // Bat heading in the body frame: yaw 0 = toward the player's right.
  heading(yaw: number, pitch: number): THREE.Vector3 {
    return this.dir([Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch)]);
  }

  // Poses everything except the arms.
  poseBody(p: Pose) {
    for (const [bone, q] of this.rest) bone.quaternion.copy(q);
    this.root.position.copy(this.spot).add(this.offset(p.shift));
    this.root.updateMatrixWorld(true);

    rotateWorld(this.bones.pelvis, new THREE.Quaternion().setFromAxisAngle(UP, p.hip));
    rotateWorld(this.bones.spine, new THREE.Quaternion().setFromAxisAngle(UP, p.spine));
    const chestF = this.dir([0, 0, 1], p.hip + p.spine);
    const leanAxis = new THREE.Vector3().crossVectors(UP, chestF).normalize();
    rotateWorld(this.bones.spine, new THREE.Quaternion().setFromAxisAngle(leanAxis, p.lean));

    for (const side of ["L", "R"] as const) {
      const foot = side === "L" ? p.footL : p.footR;
      const target = this.ankleRest[side]
        .clone()
        .add(new THREE.Vector3().addScaledVector(this.R, foot[0]).addScaledVector(UP, foot[1]).addScaledVector(this.F, foot[2]))
        .multiplyScalar(this.scale)
        .applyQuaternion(this.root.quaternion)
        .add(this.spot);
      const pole = this.dir([side === "L" ? -0.3 : 0.3, 0, 1]);
      ik(this.bones[`hip${side}`], this.bones[`knee${side}`], this.bones[`ankle${side}`], target, pole);
      aim(this.bones[`ankle${side}`], this.bones[`toe${side}`], this.footDir[side].clone().applyQuaternion(this.root.quaternion));
    }
  }

  chestPoint(v: V3, yaw: number): THREE.Vector3 {
    return this.bones.chest.getWorldPosition(new THREE.Vector3()).add(this.offset(v, yaw));
  }

  reach(side: Side, target: THREE.Vector3, pole: THREE.Vector3) {
    ik(this.bones[`shoulder${side}`], this.bones[`elbow${side}`], this.bones[`wrist${side}`], target, pole);
  }

  wrist(side: Side): THREE.Vector3 {
    return this.bones[`wrist${side}`].getWorldPosition(new THREE.Vector3());
  }
}

// ---------- Scene ----------

let renderer: THREE.WebGLRenderer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let batter: Player;
let pitcher: Player;
let bat: THREE.Group;
let ball: THREE.Mesh;
let trail: THREE.Mesh[] = [];
let hoop: THREE.Group;
let ready: Promise<void> | null = null;
let loaded = false;
let wantActive = false;
let active = false;

let contactPoint = new THREE.Vector3();
let pitchPath: THREE.CatmullRomCurve3;
let contactU = 0.85; // fraction of the path at the contact point

function paintField(): THREE.CanvasTexture {
  const size = 2048;
  const span = 160; // meters, x in [-80, 80], z in [-150, 10]
  const ppm = size / span;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const px = (x: number, z: number): [number, number] => [(x + 80) * ppm, (z + 150) * ppm];
  const circle = (x: number, z: number, r: number) => {
    ctx.beginPath();
    ctx.arc(...px(x, z), r * ppm, 0, Math.PI * 2);
    ctx.fill();
  };
  const grass = () => {
    ctx.fillStyle = "#4fb548";
    ctx.fillRect(0, 0, size, size);
    ctx.save();
    ctx.translate(...px(0, 0));
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    const cell = 7 * ppm;
    for (let i = -30; i < 30; i++) {
      for (let j = -30; j < 30; j++) if ((i + j) % 2 === 0) ctx.fillRect(i * cell, j * cell, cell, cell);
    }
    ctx.restore();
  };

  grass();

  const b = BASE_DIST / Math.SQRT2;
  const dirt = "#d9a066";
  ctx.fillStyle = dirt;

  // Warning track and infield skin, clipped to fair territory.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(...px(0, 0));
  ctx.lineTo(...px(160, -160));
  ctx.lineTo(...px(-160, -160));
  ctx.closePath();
  ctx.clip();
  ctx.lineWidth = 4 * ppm;
  ctx.strokeStyle = dirt;
  ctx.beginPath();
  ctx.arc(...px(0, 0), (WALL_RADIUS - 2) * ppm, 0, Math.PI * 2);
  ctx.stroke();
  circle(MOUND.x, MOUND.z, 20);
  ctx.restore();

  // Infield grass inside the base paths.
  ctx.save();
  const inset = 0.84;
  const cz = -b;
  ctx.beginPath();
  ctx.moveTo(...px(0, cz + b * inset));
  ctx.lineTo(...px(b * inset, cz));
  ctx.lineTo(...px(0, cz - b * inset));
  ctx.lineTo(...px(-b * inset, cz));
  ctx.closePath();
  ctx.clip();
  grass();
  ctx.restore();

  ctx.fillStyle = dirt;
  circle(0, 0, 4.2);
  circle(b, -b, 2.2);
  circle(0, -2 * b, 2.2);
  circle(-b, -b, 2.2);
  circle(MOUND.x, MOUND.z, 2.9);
  ctx.lineWidth = 1.1 * ppm;
  ctx.strokeStyle = dirt;
  ctx.beginPath();
  ctx.moveTo(...px(0, 0));
  ctx.lineTo(...px(b, -b));
  ctx.moveTo(...px(0, 0));
  ctx.lineTo(...px(-b, -b));
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function chalkLine(from: THREE.Vector3, to: THREE.Vector3, width = 0.08) {
  const len = from.distanceTo(to);
  const line = new THREE.Mesh(new THREE.PlaneGeometry(width, len), new THREE.MeshLambertMaterial({ color: 0xffffff }));
  line.rotation.x = -Math.PI / 2;
  line.rotation.z = -Math.atan2(to.x - from.x, -(to.z - from.z));
  line.position.copy(from).lerp(to, 0.5).setY(0.015);
  line.receiveShadow = true;
  return line;
}

function buildBallpark() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshLambertMaterial({ map: paintField() }));
  const map = (ground.material as THREE.MeshLambertMaterial).map!;
  map.anisotropy = renderer.capabilities.getMaxAnisotropy();
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, -70);
  ground.receiveShadow = true;
  scene.add(ground);

  // Foul lines and batter's boxes.
  const diag = (s: number) => new THREE.Vector3(s, 0, -1).normalize().multiplyScalar(WALL_RADIUS);
  scene.add(chalkLine(new THREE.Vector3(0, 0, 0), diag(1), 0.1), chalkLine(new THREE.Vector3(0, 0, 0), diag(-1), 0.1));
  for (const s of [-1, 1]) {
    const cx = s * 0.82;
    const [x0, x1, z0, z1] = [cx - 0.45, cx + 0.45, -0.75, 0.95];
    const c = [new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x1, 0, z0), new THREE.Vector3(x1, 0, z1), new THREE.Vector3(x0, 0, z1)];
    for (let i = 0; i < 4; i++) scene.add(chalkLine(c[i], c[(i + 1) % 4], 0.06));
  }

  const plate = new THREE.Shape([
    new THREE.Vector2(-0.215, 0),
    new THREE.Vector2(0.215, 0),
    new THREE.Vector2(0.215, 0.215),
    new THREE.Vector2(0, 0.43),
    new THREE.Vector2(-0.215, 0.215),
  ]);
  const homePlate = new THREE.Mesh(new THREE.ExtrudeGeometry(plate, { depth: 0.03, bevelEnabled: false }), toon(0xffffff));
  homePlate.rotation.x = Math.PI / 2;
  homePlate.position.set(0, 0.03, -0.2);
  homePlate.receiveShadow = true;
  scene.add(homePlate);

  const b = BASE_DIST / Math.SQRT2;
  for (const [x, z] of [[b, -b], [0, -2 * b], [-b, -b]]) {
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.42), toon(0xffffff));
    base.position.set(x, 0.05, z);
    base.rotation.y = Math.PI / 4;
    scene.add(base);
  }

  const mound = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.8, MOUND.y, 40), toon(0xd9a066));
  mound.position.set(MOUND.x, MOUND.y / 2, MOUND.z);
  mound.receiveShadow = true;
  const rubber = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.04, 0.15), toon(0xffffff));
  rubber.position.set(MOUND.x, MOUND.y + 0.01, MOUND.z - 0.12);
  scene.add(mound, rubber);

  // Outfield wall, foul poles, and the stands wrapping around.
  const arcStart = Math.PI * 0.55;
  const arcLen = Math.PI * 0.9;
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(WALL_RADIUS, WALL_RADIUS, 3.2, 96, 1, true, arcStart, arcLen),
    new THREE.MeshToonMaterial({ color: 0x1f6f4a, gradientMap: toonRamp, side: THREE.DoubleSide })
  );
  wall.position.y = 1.6;
  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(WALL_RADIUS + 0.05, WALL_RADIUS + 0.05, 0.3, 96, 1, true, arcStart, arcLen),
    new THREE.MeshBasicMaterial({ color: 0xffc928, side: THREE.DoubleSide })
  );
  pad.position.y = 3.25;
  scene.add(wall, pad);
  for (const s of [-1, 1]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 16, 10), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
    pole.position.copy(diag(s)).setY(8);
    scene.add(pole);
  }

  const STANDS_RISE = 15;
  const STANDS_DEPTH = 22;
  const stands = new THREE.Mesh(
    new THREE.CylinderGeometry(WALL_RADIUS + 3 + STANDS_DEPTH, WALL_RADIUS + 3, STANDS_RISE, 96, 1, true, arcStart, arcLen),
    new THREE.MeshToonMaterial({ color: 0x2c3e75, gradientMap: toonRamp, side: THREE.DoubleSide })
  );
  stands.position.y = STANDS_RISE / 2;
  scene.add(stands);

  // Crowd: one instanced box per fan, in rows up the slope.
  const palette = [0xffffff, 0xffd23f, 0x1e6fd9, 0xe53935, 0xff8a3d, 0x7ed957, 0xf2f2f2, 0x9b6bff];
  const fans: THREE.Matrix4[] = [];
  const dummy = new THREE.Object3D();
  for (let row = 0; row < 10; row++) {
    const f = (row + 0.5) / 10;
    const r = WALL_RADIUS + 3 + STANDS_DEPTH * f;
    const y = STANDS_RISE * f;
    const count = Math.floor((arcLen * r) / 1.3);
    for (let i = 0; i < count; i++) {
      if (Math.random() < 0.28) continue;
      const theta = arcStart + ((i + Math.random() * 0.4) / count) * arcLen;
      dummy.position.set(Math.sin(theta) * (r - 0.8), y + 0.7, Math.cos(theta) * (r - 0.8));
      dummy.lookAt(0, y + 0.7, 0);
      dummy.updateMatrix();
      fans.push(dummy.matrix.clone());
    }
  }
  const crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 1.3, 0.5), new THREE.MeshLambertMaterial(), fans.length);
  const color = new THREE.Color();
  fans.forEach((m, i) => {
    crowd.setMatrixAt(i, m);
    crowd.setColorAt(i, color.setHex(palette[Math.floor(Math.random() * palette.length)]));
  });
  scene.add(crowd);

  // Light towers and a sign on the outfield wall.
  for (const theta of [Math.PI * 0.62, Math.PI * 1.38]) {
    const r = WALL_RADIUS + 34;
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 46, 8), toon(0x8a94a6));
    tower.position.set(Math.sin(theta) * r, 23, Math.cos(theta) * r);
    const lamps = new THREE.Mesh(new THREE.BoxGeometry(9, 5, 1), new THREE.MeshBasicMaterial({ color: 0xfff6d5 }));
    lamps.position.set(tower.position.x, 47, tower.position.z);
    lamps.lookAt(0, 47, 0);
    scene.add(tower, lamps);
  }
  scene.add(buildWallSign());

  // A few cartoon clouds.
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (const [x, y, z, s] of [[-90, 60, -230, 1.2], [40, 72, -260, 1.5], [130, 55, -210, 1], [-170, 80, -190, 1.3]]) {
    const cloud = new THREE.Group();
    for (const [dx, dy, r] of [[0, 0, 9], [10, -2, 7], [-10, -3, 6.5], [4, 5, 7]]) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), cloudMat);
      puff.position.set(dx, dy, 0);
      cloud.add(puff);
    }
    cloud.position.set(x, y, z);
    cloud.scale.set(s * 1.6, s, s);
    scene.add(cloud);
  }
}

function buildWallSign() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 160;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#14213d";
  ctx.fillRect(0, 0, 1024, 160);
  ctx.font = "bold 104px Fredoka, 'Arial Rounded MT Bold', sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  ctx.fillStyle = "#ffc928";
  ctx.fillText("HOMEWORK", 600, 86);
  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  ctx.fillText("HOMERS", 630, 86);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(16, 2.5), new THREE.MeshBasicMaterial({ map: tex }));
  const theta = Math.PI - 0.16; // right of center, clear of the batter and pitcher
  // Pulled in from the curved wall so the flat sign's ends don't sink into it.
  sign.position.set(Math.sin(theta) * (WALL_RADIUS - 0.7), 1.65, Math.cos(theta) * (WALL_RADIUS - 0.7));
  sign.lookAt(0, 1.65, 0);
  return sign;
}

function buildSky() {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, "#3fa9f5");
  g.addColorStop(0.6, "#8fd3ff");
  g.addColorStop(1, "#d8f1ff");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  scene.background = tex;
  scene.fog = new THREE.Fog(0xd8f1ff, 140, 360);
}

function buildProps() {
  bat = new THREE.Group();
  const wood = toon(0xc98a4b);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.013, BAT_LEN, 16), wood);
  barrel.position.y = BAT_LEN / 2 - KNOB_TO_GRIP;
  const end = new THREE.Mesh(new THREE.SphereGeometry(0.034, 16, 8), wood);
  end.scale.y = 0.35;
  end.position.y = BAT_LEN - KNOB_TO_GRIP;
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.014, 12), toon(0x3a2a1a));
  knob.position.y = -KNOB_TO_GRIP;
  bat.add(barrel, end, knob);
  bat.traverse((o) => (o.castShadow = true));
  scene.add(bat);

  const ballMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 20, 14), ballMat);
  const seam = new THREE.Mesh(
    new THREE.TorusGeometry(BALL_RADIUS * 0.98, BALL_RADIUS * 0.08, 6, 24),
    new THREE.MeshBasicMaterial({ color: 0xe53935 })
  );
  seam.rotation.x = 0.6;
  ball.add(seam);
  ball.castShadow = true;
  ball.visible = false;
  scene.add(ball);

  trail = Array.from({ length: 7 }, (_, i) => {
    const ghost = new THREE.Mesh(
      ball.geometry,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 * (1 - i / 7), depthWrite: false })
    );
    ghost.scale.setScalar(1 - i * 0.1);
    ghost.visible = false;
    scene.add(ghost);
    return ghost;
  });

  hoop = new THREE.Group();
  hoop.add(
    new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.028, 10, 48), new THREE.MeshBasicMaterial({ color: 0xffc928, transparent: true })),
    new THREE.Mesh(
      new THREE.CircleGeometry(0.3, 40),
      new THREE.MeshBasicMaterial({ color: 0xfff3b0, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide })
    )
  );
  hoop.visible = false;
  scene.add(hoop);
}

function initScene(canvas: HTMLCanvasElement): Promise<void> {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(CAMERA_FOV, 16 / 9, 0.1, 600);
  camera.position.copy(CAMERA_POS);
  camera.lookAt(CAMERA_TARGET);

  scene.add(new THREE.HemisphereLight(0xe4f4ff, 0x4a8f3c, 1.6));
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
  sun.position.set(7, 14, 4);
  sun.target.position.set(0, 0, -6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 50 });
  sun.shadow.radius = 3;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  buildSky();
  buildBallpark();
  buildProps();

  return new GLTFLoader().loadAsync(MODEL_URL).then((gltf) => {
    batter = new Player(gltf.scene, KITS.you, "helmet");
    batter.place(BATTER_SPOT, new THREE.Vector3(1, 0, 0));
    pitcher = new Player(gltf.scene, KITS.cpu, "cap");
    pitcher.place(MOUND, new THREE.Vector3(0, 0, 1));
    scene.add(batter.root, pitcher.root);
    measurePitchPath();
    updateBatter(BATTER_STANCE);
    updatePitcher(PITCHER_SET);
    loaded = true;
    syncLoop();
  });
}

// ---------- Posing the players ----------

function updateBatter(p: Pose) {
  batter.poseBody(p);
  const yaw = p.hip + p.spine;
  const grip = batter.chestPoint(p.handR, yaw);
  const dir = batter.heading(p.batYaw, p.batPitch);
  bat.position.copy(grip);
  bat.quaternion.setFromUnitVectors(UP, dir);
  // Top (right) hand above the bottom (left) hand on the handle; elbows down.
  batter.reach("R", grip.clone().addScaledVector(dir, 0.045), batter.dir([0.9, -1, -0.3]));
  batter.reach("L", grip.clone().addScaledVector(dir, -0.045), batter.dir([-0.4, -1, 0.2]));
}

function updatePitcher(p: Pose) {
  pitcher.poseBody(p);
  const yaw = p.hip + p.spine;
  pitcher.reach("R", pitcher.chestPoint(p.handR, yaw), pitcher.dir([1, -0.5, -0.4], yaw));
  pitcher.reach("L", pitcher.chestPoint(p.handL, yaw), pitcher.dir([-1, -0.5, 0], yaw));
}

function sweetSpot(): THREE.Vector3 {
  const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(bat.quaternion);
  return bat.position.clone().addScaledVector(dir, SWEET_SPOT);
}

// The ball's route is measured off the real poses: it leaves the pitcher's
// hand at release and crosses the bat's sweet spot at the contact frame.
function measurePitchPath() {
  updatePitcher(sampleKeys(PITCHER_THROW, 0));
  const release = pitcher.wrist("R").add(pitcher.dir([0, 0.02, 0.08]).multiplyScalar(PLAYER_HEIGHT));
  updateBatter(BATTER_CONTACT);
  contactPoint = sweetSpot();
  const mid = release.clone().lerp(contactPoint, 0.45).add(new THREE.Vector3(0, 0.35, 0));
  const past = contactPoint.clone().add(new THREE.Vector3(0.1, -0.7, 2.6));
  pitchPath = new THREE.CatmullRomCurve3([release, mid, contactPoint, past], false, "centripetal");

  let best = Infinity;
  for (let i = 0; i <= 600; i++) {
    const d = pitchPath.getPointAt(i / 600).distanceTo(contactPoint);
    if (d < best) {
      best = d;
      contactU = i / 600;
    }
  }
}

// ---------- Pitch clock ----------

interface Pitch {
  release: number; // performance.now() when the ball leaves the hand
  pitchMs: number;
  k: number; // ease-out exponent: fast out of the hand, floating through the zone
  classify: (pos: number) => Outcome;
  resolve: (result: PitchResult) => void;
  swing: { at: number; outcome: Outcome } | null;
}

export interface PitchResult {
  outcome: Outcome;
  swung: boolean;
}

interface Flight {
  from: THREE.Vector3;
  to: THREE.Vector3;
  height: number;
  start: number;
  ms: number;
}

const FLIGHTS: Record<HitType, { dist: number; height: number; ms: number; spread: number; landY: number }> = {
  single: { dist: 32, height: 3.5, ms: 950, spread: 0.65, landY: 0 },
  double: { dist: 50, height: 11, ms: 1250, spread: 0.75, landY: 0 },
  triple: { dist: 57, height: 16, ms: 1450, spread: 0.7, landY: 0 },
  homerun: { dist: 82, height: 30, ms: 2000, spread: 0.4, landY: 12 },
};

let pitch: Pitch | null = null;
let lastRelease: number | null = null;
let swingStart: number | null = null;
let flight: Flight | null = null;
let ballHideAt = 0;
let cameraFocus = 0; // 0 = home view, 1 = following the ball
let debugClock: { batterMs?: number; pitcherMs?: number; ballPhase?: number; view?: [number[], number[], number] } | null = null;

const ballAt = (p: Pitch, phase: number) => pitchPath.getPointAt(1 - Math.pow(1 - THREE.MathUtils.clamp(phase, 0, 1), p.k));

function updatePitch(now: number) {
  if (!pitch) return;
  const p = pitch;
  const phase = (now - p.release) / p.pitchMs;
  hoop.visible = phase > -0.25;
  if (phase < 0) return;

  const glow = THREE.MathUtils.clamp(1 - Math.abs(phase - 0.5) / 0.32, 0, 1);
  const ring = hoop.children[0] as THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  ring.material.opacity = 0.4 + 0.6 * glow;
  ring.material.color.setHex(Math.abs(phase - 0.5) <= 0.05 ? 0xfff176 : 0xffc928);
  hoop.scale.setScalar(1 + 0.18 * glow);

  ball.visible = true;
  const s = p.swing;
  if (s && s.outcome !== "strike") {
    const since = now - s.at;
    if (since >= CONTACT_MS) {
      launch(s.outcome, now);
      finishPitch(s.outcome);
      return;
    }
    // Draw the ball onto the bat as it comes through the zone.
    ball.position.lerpVectors(ballAt(p, phase), contactPoint, easeIn(since / CONTACT_MS));
  } else {
    ball.position.copy(ballAt(p, phase));
    if (phase >= 1) {
      ballHideAt = now + 120;
      finishPitch(s ? s.outcome : "strike");
    }
  }
}

function finishPitch(outcome: Outcome) {
  const p = pitch!;
  pitch = null;
  hoop.visible = false;
  p.resolve({ outcome, swung: !!p.swing });
}

function launch(hit: HitType, now: number) {
  const f = FLIGHTS[hit];
  const angle = (Math.random() * 2 - 1) * f.spread * (Math.PI / 4);
  const from = contactPoint.clone();
  const to = new THREE.Vector3(Math.sin(angle) * f.dist, f.landY, -Math.cos(angle) * f.dist);
  flight = { from, to, height: f.height, start: now, ms: f.ms };
}

function updateFlight(now: number) {
  if (!flight) return;
  const t = (now - flight.start) / flight.ms;
  if (t >= 1) {
    flight = null;
    ballHideAt = now + 400;
    return;
  }
  ball.position.lerpVectors(flight.from, flight.to, t).y += 4 * flight.height * t * (1 - t);
}

const trailHistory: THREE.Vector3[] = [];

function updateBallFx(now: number, dt: number) {
  if (ballHideAt && now >= ballHideAt && !flight && !pitch) {
    ball.visible = false;
    ballHideAt = 0;
  }
  ball.rotation.x += dt * 25;
  ball.rotation.y += dt * 9;
  trailHistory.unshift(ball.position.clone());
  trailHistory.length = Math.min(trailHistory.length, trail.length * 2 + 2);
  trail.forEach((ghost, i) => {
    const pos = trailHistory[(i + 1) * 2];
    ghost.visible = ball.visible && !!pos;
    if (pos) ghost.position.copy(pos);
  });
}

const lookTarget = new THREE.Vector3();
const followPoint = new THREE.Vector3();

// Follows a batted ball like a TV camera, then eases back to home. It tilts
// up less than it pans so a towering homer doesn't lose the field.
function updateCamera(dt: number) {
  cameraFocus = THREE.MathUtils.damp(cameraFocus, flight ? 1 : 0, flight ? 3 : 2, dt);
  if (flight) followPoint.copy(ball.position);
  lookTarget.copy(CAMERA_TARGET).lerp(followPoint, 0.55 * cameraFocus);
  lookTarget.y = THREE.MathUtils.lerp(CAMERA_TARGET.y, followPoint.y, 0.3 * cameraFocus);
  camera.lookAt(lookTarget);
  camera.fov = CAMERA_FOV - 8 * cameraFocus;
  camera.updateProjectionMatrix();
}

function resizeIfNeeded() {
  const canvas = renderer.domElement;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width === 0 || height === 0) return;
  if (canvas.width !== Math.floor(width * renderer.getPixelRatio()) || canvas.height !== Math.floor(height * renderer.getPixelRatio())) {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
}

let lastFrame = 0;

function renderFrame(now: number) {
  const dt = Math.min((now - (lastFrame || now)) / 1000, 0.1);
  lastFrame = now;
  resizeIfNeeded();
  const t = now / 1000;

  if (swingStart !== null && now - swingStart > SWING_TOTAL_MS) swingStart = null;
  let bp: Pose;
  if (debugClock?.batterMs !== undefined) bp = sampleKeys(BATTER_SWING, debugClock.batterMs);
  else if (swingStart !== null) bp = sampleKeys(BATTER_SWING, now - swingStart);
  else {
    // Idle: breathe and waggle the bat.
    bp = pose({ ...BATTER_STANCE, batYaw: BATTER_STANCE.batYaw + Math.sin(t * 1.7) * 0.12 });
    bp.shift = [BATTER_STANCE.shift[0], BATTER_STANCE.shift[1] + Math.sin(t * 2.1) * 0.006, 0];
  }
  updateBatter(bp);

  const release = pitch ? pitch.release : lastRelease;
  if (release !== null && now - release > PITCH_FOLLOW_MS) lastRelease = null;
  let pp: Pose;
  if (debugClock?.pitcherMs !== undefined) pp = sampleKeys(PITCHER_THROW, debugClock.pitcherMs);
  else if (release !== null) pp = sampleKeys(PITCHER_THROW, now - release);
  else pp = pose({ ...PITCHER_SET, shift: [0, PITCHER_SET.shift[1] + Math.sin(t * 1.9) * 0.005, 0] });
  updatePitcher(pp);

  if (debugClock?.ballPhase !== undefined) {
    const k = 2.4; // roughly the Rookie League ease
    ball.visible = true;
    ball.position.copy(pitchPath.getPointAt(1 - Math.pow(1 - debugClock.ballPhase, k)));
    hoop.visible = true;
    hoop.position.copy(pitchPath.getPointAt(1 - Math.pow(0.5, k)));
  } else {
    updatePitch(now);
    updateFlight(now);
  }
  updateBallFx(now, dt);
  updateCamera(dt);
  if (debugClock?.view) {
    const [pos, target, fov] = debugClock.view;
    camera.position.fromArray(pos);
    camera.lookAt(new THREE.Vector3().fromArray(target));
    camera.fov = fov;
    camera.updateProjectionMatrix();
  } else {
    camera.position.copy(CAMERA_POS);
  }
  renderer.render(scene, camera);
}

// ---------- Public API ----------

export function initStage(canvas: HTMLCanvasElement): Promise<void> {
  ready ??= initScene(canvas);
  return ready;
}

// Runs the render loop only while the stage is on screen and loaded.
export function setStageActive(on: boolean) {
  wantActive = on;
  syncLoop();
}

function syncLoop() {
  const run = loaded && wantActive;
  if (run === active) return;
  active = run;
  lastFrame = 0;
  renderer.setAnimationLoop(run ? renderFrame : null);
}

// Runs one pitch: wind-up, then the ball floats in. Resolves with the
// outcome — at bat-on-ball for a hit, or when the ball reaches the catcher.
export async function playPitch(opts: { pitchMs: number; classify: (pos: number) => Outcome }): Promise<PitchResult> {
  await ready;
  const now = performance.now();
  // The bat arrives CONTACT_MS after a swing: shape the ball's ease so a
  // swing at phase 0.5 meets it at the contact point.
  const contactPhase = Math.min(0.5 + CONTACT_MS / opts.pitchMs, 0.9);
  const k = Math.log(1 - contactU) / Math.log(1 - contactPhase);
  hoop.position.copy(pitchPath.getPointAt(1 - Math.pow(0.5, k)));
  trailHistory.length = 0;
  flight = null;
  ball.visible = false;
  return new Promise((resolve) => {
    pitch = { release: now + WINDUP_MS, pitchMs: opts.pitchMs, k, classify: opts.classify, resolve, swing: null };
    lastRelease = pitch.release;
  });
}

// Swings the bat. Ignored during the wind-up or once this pitch is decided.
// Pass the input event's timeStamp so a busy frame on a slow device doesn't
// make an on-time swing count as late.
export function swing(at = performance.now()) {
  if (!pitch || pitch.swing || at < pitch.release) return;
  const phase = (at - pitch.release) / pitch.pitchMs;
  if (phase > 1) return;
  pitch.swing = { at, outcome: pitch.classify(phase * 100) };
  swingStart = at;
}

if (import.meta.env.DEV) {
  // Dev-only hooks for tuning poses: freeze the animation at a given moment
  // (optionally with a custom camera), or swing at an exact pitch phase.
  (window as unknown as { __stage: unknown }).__stage = {
    freeze: (clock: typeof debugClock) => (debugClock = clock),
    phase: () => (pitch ? (performance.now() - pitch.release) / pitch.pitchMs : null),
    swing,
  };
}
