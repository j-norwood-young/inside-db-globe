import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TextureLoader } from 'three';
import { sunState, latLonToDir } from './sun';
import { makeEarthMaterial } from './earth';
import { makeCloudMaterial } from './clouds';
import { makeAtmosphereMaterial } from './atmosphere';
import { makeStarfield } from './starfield';
import {
  makeStoryLayer,
  satellitePosition,
  type SpreadLayout,
  type StoryLayerHandle
} from '../stories/storyLayer';
import { makePicking, type Picking } from '../stories/picking';
import type { Story } from '../data';

export interface SceneHandles {
  /** sim time (epoch ms) driving the sun position and the story markers */
  setSimTime(t: number): void;
  setStoryVisibility(mask: Uint8Array): void;
  /** sim-ms per real-ms; stretches marker animations so they stay visible at high speed */
  setTimeScale(speed: number): void;
  /**
   * Published + visible stories under the pointer, nearest first. While a
   * cluster is in orbit, a hit on one of its satellites returns just that story.
   */
  pickAt(clientX: number, clientY: number): number[];
  /**
   * Fly to a story and orbit around it, tilted. With more than one member the
   * group is lifted into satellite rings above the place (members[0] = the
   * selected story).
   */
  focus(members: number[]): void;
  /**
   * Drop any satellites and fly back to the view from before the first
   * focus (position + orientation), or with `home` to the starting zoom level.
   */
  unfocus(opts?: { home?: boolean }): void;
  /** closer than the starting view, or orbiting a focused place */
  isZoomedIn(): boolean;
  /** fly to a regional view centred on the globe point under the pointer; false if it missed the globe */
  zoomToPoint(clientX: number, clientY: number): boolean;
  setHighlight(selected: number, hovered: number): void;
  /** allow the slow idle camera orbit (off during the intro so the view stays put) */
  setIdleDrift(enabled: boolean): void;
  /** px at the bottom of the canvas covered by UI (e.g. a phone sheet); the globe re-centres in the rest */
  setBottomInset(px: number): void;
  /** resolves once every texture has loaded (or failed — the globe still renders) */
  ready: Promise<void>;
  resize(): void;
  dispose(): void;
  debug: { spreadScreen: () => { index: number; x: number; y: number }[]; renderer: THREE.WebGLRenderer; camera: THREE.PerspectiveCamera; earth: THREE.Object3D; project: (lat: number, lon: number) => { x: number; y: number; visible: boolean } };
}

const TEXTURES = {
  day: '/textures/earth_day_2048.jpg',
  night: '/textures/earth_night_2048.jpg',
  spec: '/textures/earth_specular_2048.jpg',
  normal: '/textures/earth_normal_2048.jpg',
  clouds: '/textures/earth_clouds_2048.jpg'
};

export function createScene(container: HTMLElement, stories: Story[]): SceneHandles {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  const dpr = Math.min(window.devicePixelRatio || 1, 2); // perf: cap DPR
  renderer.setPixelRatio(dpr);
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x03050c);

  const camera = new THREE.PerspectiveCamera(
    42,
    container.clientWidth / container.clientHeight,
    0.01,
    1000
  );
  // open over Europe/Africa, where most of the coverage is
  const HOME_DIST = 3.6; // starting zoom level
  latLonToDir(15, 15, camera.position).multiplyScalar(HOME_DIST);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.45;
  controls.enablePan = false;
  controls.minDistance = 1.35;
  controls.maxDistance = 8;

  let markReady!: () => void;
  const ready = new Promise<void>((res) => (markReady = res));
  // onLoad fires once nothing is pending, including after a failed load
  const manager = new THREE.LoadingManager(markReady, undefined, (url) =>
    console.warn('texture failed to load:', url)
  );
  const loader = new TextureLoader(manager);
  const load = (url: string, srgb: boolean) => {
    const t = loader.load(url);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };

  /**
   * Stock SphereGeometry already matches an equirectangular (0°-centred)
   * texture with lon 0° at +x and 90°E at −z — see latLonToDir in sun.ts.
   */
  const makeSphere = (radius: number, w: number, h: number) => new THREE.SphereGeometry(radius, w, h);

  // ---- Earth
  const earthGeo = makeSphere(1, 128, 96);
  const earthMat = makeEarthMaterial(
    load(TEXTURES.day, true),
    load(TEXTURES.night, true),
    load(TEXTURES.spec, true),
    load(TEXTURES.normal, false)
  );
  const earth = new THREE.Mesh(earthGeo, earthMat);
  scene.add(earth);

  // ---- Clouds (slightly larger shell, independent slow drift)
  const cloudMat = makeCloudMaterial(load(TEXTURES.clouds, false));
  const clouds = new THREE.Mesh(makeSphere(1.006, 96, 64), cloudMat);
  clouds.rotation.y = 0.05; // decorative offset so cloud seams don't align with the earth's
  scene.add(clouds);

  // ---- Atmosphere rim
  const atmoMat = makeAtmosphereMaterial();
  const atmosphere = new THREE.Mesh(makeSphere(1.05, 64, 48), atmoMat);
  scene.add(atmosphere);

  // ---- Starfield
  const stars = makeStarfield();
  scene.add(stars);

  // ---- Stories (children of the rotating Earth so lat/lon stay true)
  const storyLayer: StoryLayerHandle = makeStoryLayer(earth, stories);

  // ---- Picking
  const picking: Picking = makePicking(camera, earth, stories, (i) =>
    visibleMaskCheck(i)
  );
  let visibleMask: Uint8Array = new Uint8Array(stories.length).fill(1);
  let storyTime = Infinity;
  function visibleMaskCheck(i: number): boolean {
    return visibleMask[i] === 1 && stories[i].publishedAt <= storyTime;
  }

  // per-sim-frame state (updated from Svelte when the sim clock advances)
  const earthSimSun = new THREE.Vector3(1, 0, 0);
  const sunDirV = new THREE.Vector3();

  // idle camera drift: slow auto-orbit when the user has been inactive
  let lastInteraction = performance.now();
  let idleDrift = true;
  const stopIdle = () => (lastInteraction = performance.now());
  renderer.domElement.addEventListener('pointermove', stopIdle);
  renderer.domElement.addEventListener('pointerdown', stopIdle);
  renderer.domElement.addEventListener('wheel', stopIdle);

  // ---- camera flight. The orbit target moves too: the globe centre normally,
  // the focused place while a story is open (so dragging orbits around it).
  // The camera's direction from the globe centre is slerped so it never cuts
  // through the planet; any user orbit/zoom takes over immediately.
  const FLY_MS = 1400;
  const HOME_LIMITS = { min: 1.35, max: 8 };
  const FOCUS_LIMITS = { min: 0.25, max: 3 };
  let flight: {
    from: THREE.Vector3; // camera direction from the globe centre
    to: THREE.Vector3;
    r0: number;
    r1: number;
    angle: number;
    t0: THREE.Vector3; // orbit target
    t1: THREE.Vector3;
    start: number;
    returning: boolean; // flying back to `preFocus`
  } | null = null;

  // The view from before the first focus. Focusing story after story keeps
  // it; unfocusing flies back to it. Cleared once we're back, or if the user
  // takes over the camera on the way.
  let focused = false;
  let preFocus: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;

  const cancelFlight = () => {
    if (flight?.returning) preFocus = null;
    flight = null;
  };

  // ---- flick-to-spin: a fast horizontal release keeps the globe turning
  // about its axis (like a desk globe), slowing over a few seconds
  const SPIN_MIN_PX_PER_MS = 0.5; // slower releases just use OrbitControls' damping
  const SPIN_DECAY_S = 1.6; // e-folding time of the spin
  const SPIN_MAX = 8; // rad/s
  const yAxis = new THREE.Vector3(0, 1, 0);
  let spinRate = 0; // rad/s about world Y, around the orbit target
  let dragSamples: { x: number; t: number }[] = [];
  const activePointers = new Set<number>();
  renderer.domElement.addEventListener('pointerdown', (e) => {
    activePointers.add(e.pointerId);
    spinRate = 0;
    dragSamples = [{ x: e.clientX, t: performance.now() }];
  });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (!activePointers.has(e.pointerId)) return;
    const now = performance.now();
    dragSamples.push({ x: e.clientX, t: now });
    while (dragSamples.length > 2 && now - dragSamples[0].t > 100) dragSamples.shift();
  });
  const onPointerEnd = (e: PointerEvent) => {
    if (!activePointers.delete(e.pointerId)) return;
    const multi = activePointers.size > 0; // finishing a pinch isn't a flick
    const first = dragSamples[0];
    const last = dragSamples[dragSamples.length - 1];
    dragSamples = [];
    if (multi || !first || !last || reduceMotion) return;
    const dt = last.t - first.t;
    // a pause before letting go means no flick
    if (dt < 16 || performance.now() - last.t > 60) return;
    const vx = (last.x - first.x) / dt; // px/ms
    if (Math.abs(vx) < SPIN_MIN_PX_PER_MS) return;
    // same angle-per-pixel as OrbitControls' rotate, so the spin continues the drag
    const h = renderer.domElement.clientHeight;
    const rate = ((-2 * Math.PI * vx * 1000) / h) * controls.rotateSpeed;
    spinRate = THREE.MathUtils.clamp(rate, -SPIN_MAX, SPIN_MAX);
  };
  renderer.domElement.addEventListener('pointerup', onPointerEnd);
  renderer.domElement.addEventListener('pointercancel', onPointerEnd);
  renderer.domElement.addEventListener('wheel', () => (spinRate = 0), { passive: true });

  let lastSpinFrame = performance.now();
  function stepSpin(now: number) {
    const dt = Math.min(0.1, (now - lastSpinFrame) / 1000);
    lastSpinFrame = now;
    if (!spinRate) return;
    if (flight) {
      spinRate = 0;
      return;
    }
    camera.position.sub(controls.target).applyAxisAngle(yAxis, spinRate * dt).add(controls.target);
    spinRate *= Math.exp(-dt / SPIN_DECAY_S);
    if (Math.abs(spinRate) < 0.02) spinRate = 0;
    lastInteraction = now; // no idle drift while it coasts
  }
  renderer.domElement.addEventListener('pointerdown', cancelFlight);
  renderer.domElement.addEventListener('wheel', cancelFlight, { passive: true });
  const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const flyDir = new THREE.Vector3();

  const raycaster = new THREE.Raycaster();
  const globeSphere = new THREE.Sphere(new THREE.Vector3(), 1);

  function flyCamera(endPos: THREE.Vector3, endTarget: THREE.Vector3, returning = false) {
    const from = camera.position.clone().normalize();
    const to = endPos.clone().normalize();
    flight = {
      from,
      to,
      r0: camera.position.length(),
      r1: endPos.length(),
      angle: Math.acos(THREE.MathUtils.clamp(from.dot(to), -1, 1)),
      t0: controls.target.clone(),
      t1: endTarget.clone(),
      start: performance.now(),
      returning
    };
  }

  function stepFlight(now: number) {
    if (!flight) return;
    const k = Math.min(1, (now - flight.start) / FLY_MS);
    const e = easeInOut(k);
    const { from, to, angle } = flight;
    if (angle < 1e-4) flyDir.copy(to);
    else {
      const s = Math.sin(angle);
      flyDir
        .copy(from)
        .multiplyScalar(Math.sin((1 - e) * angle) / s)
        .addScaledVector(to, Math.sin(e * angle) / s);
    }
    // a gentle pull-back mid-flight on long hops reads better than a straight zoom
    const hop = Math.sin(Math.PI * e) * Math.min(0.6, angle * 0.5);
    camera.position.copy(flyDir).multiplyScalar(THREE.MathUtils.lerp(flight.r0, flight.r1, e) + hop);
    controls.target.lerpVectors(flight.t0, flight.t1, e);
    lastInteraction = now; // no idle drift straight after a flight
    if (k >= 1) {
      if (flight.returning) preFocus = null;
      flight = null;
    }
  }

  /**
   * Camera pose for looking at `target` on the surface (local up `up`) from
   * the south, `elevationDeg` above the local horizon — north stays up.
   */
  function obliquePose(target: THREE.Vector3, up: THREE.Vector3, dist: number, elevationDeg: number) {
    const north = new THREE.Vector3(0, 1, 0).addScaledVector(up, -up.y);
    if (north.lengthSq() < 1e-6) north.set(1, 0, 0);
    north.normalize();
    const el = (elevationDeg * Math.PI) / 180;
    const dir = up.clone().multiplyScalar(Math.sin(el)).addScaledVector(north, -Math.cos(el));
    return target.clone().addScaledVector(dir, dist);
  }

  // ---- satellites: launched/landed with an eased amount; the layer keeps its
  // attributes until fully landed so the landing animates too
  let spread: SpreadLayout | null = null;
  let pendingSpread: number[] | null = null;
  let spreadAmt = 0;
  const SPREAD_PICK_PX = 14;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const orbitClock = new THREE.Clock();
  let orbitT = 0;
  const sv = new THREE.Vector3();
  const home = new THREE.Vector3();

  function stepSpread() {
    if (!reduceMotion) orbitT += orbitClock.getDelta();
    storyLayer.setOrbitTime(orbitT);
    const target = spread && !pendingSpread ? 1 : 0;
    if (spreadAmt === target) {
      if (pendingSpread) {
        // fully landed: launch the next cluster (or nothing)
        spread = storyLayer.setSpread(pendingSpread);
        pendingSpread = null;
      }
      return;
    }
    spreadAmt += (target - spreadAmt) * 0.08;
    if (Math.abs(target - spreadAmt) < 0.003) spreadAmt = target;
    storyLayer.setSpreadAmount(spreadAmt);
  }

  function setSpread(members: number[]) {
    const same =
      (spread?.members.length ?? 0) === members.length &&
      members.every((m, i) => spread!.members[i] === m);
    if (same && !pendingSpread) return;
    if (!spread) spread = storyLayer.setSpread(members); // nothing to land first
    else pendingSpread = members;
  }

  /** client-px positions of the satellites (mirror of the dot vertex shader) */
  function spreadScreen(): { index: number; x: number; y: number }[] {
    if (!spread) return [];
    const r = renderer.domElement.getBoundingClientRect();
    const { centre, offsets, spins, members } = spread;
    return members.map((index, j) => {
      storyLayer.getHome(index, home);
      satellitePosition(centre, offsets[j], spins[j], orbitT, sv);
      sv.lerpVectors(home, sv, spreadAmt).applyMatrix4(earth.matrixWorld).project(camera);
      return {
        index,
        x: (sv.x * 0.5 + 0.5) * r.width + r.left,
        y: (-sv.y * 0.5 + 0.5) * r.height + r.top
      };
    });
  }

  function pickSpread(clientX: number, clientY: number): number {
    if (spreadAmt < 0.5) return -1;
    let best = -1;
    let bestD = SPREAD_PICK_PX;
    for (const s of spreadScreen()) {
      const d = Math.hypot(s.x - clientX, s.y - clientY);
      if (d < bestD) {
        bestD = d;
        best = s.index;
      }
    }
    return best;
  }
  // vertical view offset (px), eased towards its target so the globe glides
  let insetTarget = 0;
  let inset = 0;
  function applyInset() {
    const w = renderer.domElement.clientWidth;
    const h = renderer.domElement.clientHeight;
    if (Math.abs(inset) < 0.5) camera.clearViewOffset();
    // shifting the view window down by inset/2 moves the scene up, centring
    // the globe in the uncovered part of the canvas
    else camera.setViewOffset(w, h, 0, inset / 2, w, h);
  }

  let disposed = false;
  let raf = 0;
  let lastFrame = performance.now();

  function frame(now: number) {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    lastFrame = now;

    // idle drift: slow auto-orbit of the camera (the planet keeps its
    // true solar orientation, so the terminator stays honest)
    stepFlight(now);
    stepSpin(now);
    stepSpread();
    controls.autoRotate = idleDrift && !flight && now - lastInteraction > 4000;
    controls.autoRotateSpeed = -0.25;
    controls.update();

    if (inset !== insetTarget) {
      inset += (insetTarget - inset) * 0.15;
      if (Math.abs(insetTarget - inset) < 0.5) inset = insetTarget;
      applyInset();
    }

    // sun direction in view space (sun position itself set via setSimTime)
    sunDirV.copy(earthSimSun).transformDirection(camera.matrixWorldInverse);

    (earthMat.uniforms.uSunDirV.value as THREE.Vector3).copy(sunDirV);
    (cloudMat.uniforms.uSunDirV.value as THREE.Vector3).copy(sunDirV);
    (atmoMat.uniforms.uSunDirV.value as THREE.Vector3).copy(sunDirV);

    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(frame);

  return {
    setSimTime(t: number) {
      // World frame == ECEF: the globe stays put (stories stay where you
      // looked) and the sun — already in ECEF — sweeps the terminator round.
      const { dir } = sunState(t);
      earthSimSun.copy(dir);
      storyTime = t;
      storyLayer.setTime(t);
    },
    setTimeScale(speed: number) {
      storyLayer.setTimeScale(speed);
    },
    setStoryVisibility(mask: Uint8Array) {
      visibleMask = mask;
      storyLayer.setVisibility(mask);
    },
    pickAt(clientX, clientY) {
      const fanned = pickSpread(clientX, clientY);
      if (fanned >= 0) return [fanned];
      const r = renderer.domElement.getBoundingClientRect();
      const nx = ((clientX - r.left) / r.width) * 2 - 1;
      const ny = -((clientY - r.top) / r.height) * 2 + 1;
      return picking.pick(nx, ny);
    },
    setHighlight(selected: number, hovered: number) {
      storyLayer.setHighlight(selected, hovered);
    },
    setIdleDrift(enabled: boolean) {
      idleDrift = enabled;
    },
    focus(members: number[]) {
      if (!members.length) return;
      // remember where we came from — unless we're already focused, or still
      // flying back to that remembered view (it stays the one to return to)
      if (!focused && !preFocus) {
        preFocus = { pos: camera.position.clone(), target: controls.target.clone() };
      }
      focused = true;
      const cluster = members.length > 1;
      setSpread(cluster ? members : []);
      // aim at the members' mean direction — the centre the rings stand on
      // (for a single story, just the story)
      const up = new THREE.Vector3();
      for (const i of members) up.add(latLonToDir(stories[i].lat, stories[i].lon));
      up.normalize();
      // frame the middle of the ring stack
      const lift = cluster ? 0.1 : 0;
      const target = up.clone().multiplyScalar(1 + lift);
      const dist = cluster ? 0.75 : 0.55;
      controls.minDistance = FOCUS_LIMITS.min;
      controls.maxDistance = FOCUS_LIMITS.max;
      flyCamera(obliquePose(target, up, dist, cluster ? 38 : 50), target);
    },
    unfocus(opts?: { home?: boolean }) {
      setSpread([]);
      if (!focused && !opts?.home) return;
      focused = false;
      controls.minDistance = HOME_LIMITS.min;
      controls.maxDistance = HOME_LIMITS.max;
      if (opts?.home || !preFocus) {
        // starting zoom along the current view direction
        preFocus = null;
        const dir = camera.position.clone().normalize();
        flyCamera(dir.multiplyScalar(HOME_DIST), new THREE.Vector3());
      } else {
        flyCamera(preFocus.pos, preFocus.target, true);
      }
    },
    isZoomedIn() {
      return controls.target.lengthSq() > 1e-8 || camera.position.length() < HOME_DIST * 0.85;
    },
    zoomToPoint(clientX: number, clientY: number) {
      const r = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(
        new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1),
        camera
      );
      const hit = raycaster.ray.intersectSphere(globeSphere, new THREE.Vector3());
      if (!hit) return false;
      setSpread([]);
      focused = false;
      preFocus = null;
      controls.minDistance = HOME_LIMITS.min;
      controls.maxDistance = HOME_LIMITS.max;
      flyCamera(hit.normalize().multiplyScalar(1.75), new THREE.Vector3());
      return true;
    },
    setBottomInset(px: number) {
      insetTarget = px;
    },
    ready,
    resize() {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      // portrait: hold the horizontal FOV so the globe fits the narrow axis
      camera.fov = w >= h ? 42 : (2 * Math.atan(Math.tan((21 * Math.PI) / 180) / camera.aspect) * 180) / Math.PI;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      applyInset();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      controls.dispose();
      storyLayer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
    debug: {
      spreadScreen,
      renderer,
      camera,
      earth,
      project(lat: number, lon: number) {
        const b = (lat * Math.PI) / 180;
        const l = (lon * Math.PI) / 180;
        const cp = Math.cos(b);
        const local = new THREE.Vector3(cp * Math.cos(l), Math.sin(b), -cp * Math.sin(l));
        local.applyMatrix4(earth.matrixWorld);
        const v = local.clone().project(camera);
        return {
          x: (v.x * 0.5 + 0.5) * renderer.domElement.clientWidth,
          y: (-v.y * 0.5 + 0.5) * renderer.domElement.clientHeight,
          visible: v.z < 1
        };
      }
    }
  };
}
