// 3D batting scene: renders a rigged batter and an incoming pitch, and
// lets the player swing with a single timed press (button or spacebar).
//
// Exposes window.startSwingMeter3D(onResult) with the same contract the
// old 2D swing meter used: call onResult(outcome) once the pitch is
// resolved, where outcome is "strike" | "single" | "double" | "triple" | "homerun".
// Hit-quality math stays in game.js (classifySwing, levelConfig) — this
// file only owns rendering, timing, and input.

import * as THREE from "three";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";

const MODEL_URL = "assets/models/CesiumMan.glb";
const SWING_ANIM_MS = 300;

const ARM_SHOULDER = "Skeleton_arm_joint_R";
const ARM_ELBOW = "Skeleton_arm_joint_R__2_";
const ARM_WRIST = "Skeleton_arm_joint_R__3_";
const TORSO_UPPER = "Skeleton_torso_joint_2";

let renderer, scene, camera, clock;
let batterRoot, ballMesh;
let bones = {};
let modelReady = null;

let activePitch = null; // { start, periodMs, from, to, phase, resolved, onResult }
let swingAnim = null; // { start }

function initScene() {
  const canvas = document.getElementById("swing3d-canvas");
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbfe3f7);

  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 1.9, 2.4);
  camera.lookAt(0, 1.3, -6);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x2e7d32, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(3, 6, 3);
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshStandardMaterial({ color: 0xa1665e })
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  ballMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0xffffff })
  );
  ballMesh.visible = false;
  scene.add(ballMesh);

  clock = new THREE.Clock();

  modelReady = new GLTFLoader().loadAsync(MODEL_URL).then((gltf) => {
    batterRoot = gltf.scene;
    batterRoot.scale.setScalar(1.15);
    batterRoot.position.set(0, 0, 0);
    batterRoot.rotation.y = Math.PI; // face the pitcher, down -Z
    scene.add(batterRoot);

    [ARM_SHOULDER, ARM_ELBOW, ARM_WRIST, TORSO_UPPER].forEach((name) => {
      const bone = batterRoot.getObjectByName(name);
      if (bone) bones[name] = bone;
    });

    // The model's bind pose is a T-pose. Bake a "batting stance" offset onto
    // the bind pose so the batter reads as holding a bat up and ready, not
    // standing with arms straight out. The swing arc (applySwingPose) and the
    // idle bob both layer on top of this baked stance via userData.restQuat.
    if (bones[ARM_SHOULDER]) {
      bones[ARM_SHOULDER].quaternion.multiply(
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -1.1)
      );
    }
    if (bones[ARM_ELBOW]) {
      bones[ARM_ELBOW].quaternion.multiply(
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.3)
      );
    }
    [ARM_SHOULDER, ARM_ELBOW, ARM_WRIST, TORSO_UPPER].forEach((name) => {
      if (bones[name]) bones[name].userData.restQuat = bones[name].quaternion.clone();
    });

    const bat = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.035, 0.75, 10),
      new THREE.MeshStandardMaterial({ color: 0x8d5524 })
    );
    bat.position.set(0, 0.42, 0);
    bat.rotation.z = Math.PI / 2;
    if (bones[ARM_WRIST]) bones[ARM_WRIST].add(bat);
  });

  renderer.setAnimationLoop(renderLoop);
}

function resizeIfNeeded() {
  const canvas = renderer.domElement;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width === 0 || height === 0) return;
  if (canvas.width !== width || canvas.height !== height) {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
}

function applySwingPose(progress) {
  const shoulder = bones[ARM_SHOULDER];
  const elbow = bones[ARM_ELBOW];
  const torso = bones[TORSO_UPPER];
  if (!shoulder || !elbow) return;
  const swing = Math.sin(Math.min(progress, 1) * Math.PI); // 0 -> 1 -> 0 arc

  shoulder.quaternion
    .copy(shoulder.userData.restQuat)
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), swing * 1.8));
  elbow.quaternion
    .copy(elbow.userData.restQuat)
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), swing * 0.6));
  if (torso) {
    torso.quaternion
      .copy(torso.userData.restQuat)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), swing * 0.5));
  }
}

function renderLoop() {
  const panel = document.getElementById("swing-panel");
  if (!panel || panel.hidden) return;
  resizeIfNeeded();

  const t = clock.getElapsedTime();
  if (batterRoot) {
    batterRoot.position.y = Math.sin(t * 1.6) * 0.015; // idle bob
  }

  if (swingAnim) {
    const progress = (performance.now() - swingAnim.start) / SWING_ANIM_MS;
    if (progress >= 1) {
      applySwingPose(0);
      swingAnim = null;
    } else {
      applySwingPose(progress);
    }
  }

  if (activePitch && !activePitch.resolved) {
    const elapsed = performance.now() - activePitch.start;
    const phase = Math.min(elapsed / activePitch.periodMs, 1);
    activePitch.phase = phase;
    ballMesh.position.lerpVectors(activePitch.from, activePitch.to, phase);
    if (phase >= 1) {
      finishPitch("strike");
    }
  }

  renderer.render(scene, camera);
}

function finishPitch(outcome) {
  if (!activePitch || activePitch.resolved) return;
  activePitch.resolved = true;
  const onResult = activePitch.onResult;
  activePitch.cleanup();
  activePitch = null;
  // Delay hiding the panel so the swing animation (if any) gets a moment
  // to render before the 3D scene stops updating.
  setTimeout(() => {
    ballMesh.visible = false;
    document.getElementById("swing-panel").hidden = true;
    onResult(outcome);
  }, 250);
}

export function startSwingMeter3D(onResult) {
  if (!renderer) initScene();

  const panel = document.getElementById("swing-panel");
  const swingBtn = document.getElementById("swing-btn");
  panel.hidden = false;

  const begin = () => {
    const periodMs = (window.levelConfig && window.levelConfig().swingSpeedMs) || 1500;
    ballMesh.visible = true;

    function handleSwing() {
      if (!activePitch || activePitch.resolved) return;
      const pos = Math.min(activePitch.phase, 1) * 100;
      const outcome = window.classifySwing(pos);
      swingAnim = { start: performance.now() };
      finishPitch(outcome);
    }
    function handleKey(e) {
      if (e.code === "Space") {
        e.preventDefault();
        handleSwing();
      }
    }

    swingBtn.addEventListener("click", handleSwing);
    document.addEventListener("keydown", handleKey);

    activePitch = {
      start: performance.now(),
      periodMs,
      from: new THREE.Vector3(0, 1.35, -9),
      to: new THREE.Vector3(0.15, 1.1, -0.2),
      phase: 0,
      resolved: false,
      onResult,
      cleanup() {
        swingBtn.removeEventListener("click", handleSwing);
        document.removeEventListener("keydown", handleKey);
      },
    };
  };

  modelReady ? modelReady.then(begin) : begin();
}

window.startSwingMeter3D = startSwingMeter3D;
