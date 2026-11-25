import * as THREE from 'three';
import type { Story } from '../data';
import { langColorRGB } from './palette';

/**
 * Story markers as three InstancedMesh systems (dot, beam, ripple) that are
 * children of the rotating Earth mesh, so they stay pinned to their lat/lon
 * as the planet turns. All animation lives in the shaders, driven by a single
 * shared uTime (sim epoch ms) uniform + per-instance aStart — zero per-frame
 * CPU work for 1,300+ markers.
 *
 * Pop-in (at publishedAt):
 *   1. expanding ground ripple for ~10 sim-minutes
 *   2. vertical light beam rising to ~6% of Earth radius
 *   3. persistent dot (constant on-screen size) that settles to a floor after
 *      ~6 sim-hours
 * Ripple/beam/pop durations are multiplied by uSpan so they stay visible when
 * the clock runs fast (e.g. the intro sweep).
 *
 * Satellites: a set of co-located stories can be lifted off the globe into
 * slowly turning orbital rings stacked above their common centre, each with a
 * tether back down to its plotted location. uSpread (0..1) animates the
 * launch; uOrbitT (s) turns the rings. satellitePosition() mirrors the shader
 * so picking can hit-test the satellites on the CPU.
 */
export interface StoryLayerHandle {
  group: THREE.Group;
  setVisibility(mask: Uint8Array): void;
  setTime(simMs: number): void;
  setTimeScale(speed: number): void;
  /** highlight one story (selected) and one (hovered); -1 for none */
  setHighlight(selected: number, hovered: number): void;
  /** lift these stories into orbit (empty = none); returns the layout used */
  setSpread(members: number[]): SpreadLayout | null;
  /** 0 = on the ground, 1 = fully in orbit */
  setSpreadAmount(v: number): void;
  /** seconds; drives the ring rotation */
  setOrbitTime(seconds: number): void;
  /** earth-local plotted position of a story's dot */
  getHome(index: number, out: THREE.Vector3): THREE.Vector3;
  /** canvas height in CSS px, for the dots' minimum on-screen size */
  setViewHeight(px: number): void;
  dispose(): void;
}

const R = 1; // Earth radius in scene units
/** dot quad size per unit of view distance (constant angular size) */
export const DOT_UNIT = 0.021;
/**
 * ...but never smaller than this many CSS px, so dots stay tappable on phones
 * (portrait holds the horizontal FOV, which would otherwise shrink them)
 */
const DOT_MIN_PX = 22;
/** satellites' largest quad (earth radii), so the floor can't overlap them in a ring */
const SAT_MAX_DOT = 0.024;

export interface SpreadLayout {
  members: number[];
  centre: THREE.Vector3; // earth-local surface point the rings stand on
  offsets: THREE.Vector3[]; // per member, from centre, before orbit rotation
  spins: number[]; // per member, rad/s about the local vertical
  /** altitude of the middle of the stack (earth radii), for framing */
  midHeight: number;
}

/**
 * Orbital rings above `centre`, filled bottom-up: each ring is wider and
 * higher than the last (an inverted cone, so rings don't hide each other from
 * an oblique view) and turns the opposite way to its neighbours.
 */
export function satelliteLayout(n: number, centre: THREE.Vector3) {
  const up = centre.clone().normalize();
  const north = new THREE.Vector3(0, 1, 0).addScaledVector(up, -up.y);
  if (north.lengthSq() < 1e-6) north.set(1, 0, 0); // at a pole
  north.normalize();
  const east = new THREE.Vector3().crossVectors(north, up).normalize();

  const SPACING = 0.026; // along a ring, earth radii (~2 dot widths at framing distance)
  const offsets: THREE.Vector3[] = [];
  const spins: number[] = [];
  let heights = [0, 0];
  for (let k = 0, left = n; left > 0; k++) {
    const radius = 0.035 + 0.028 * k;
    const height = 0.045 + 0.04 * k;
    const count = Math.min(left, Math.floor((2 * Math.PI * radius) / SPACING));
    const spin = ((k % 2 ? -1 : 1) * 0.12) / (1 + 0.3 * k);
    const phase = k * 0.7;
    for (let j = 0; j < count; j++) {
      const a = phase + (j / count) * 2 * Math.PI;
      offsets.push(
        new THREE.Vector3()
          .addScaledVector(east, radius * Math.cos(a))
          .addScaledVector(north, radius * Math.sin(a))
          .addScaledVector(up, height)
      );
      spins.push(spin);
    }
    heights = [k === 0 ? height : heights[0], height];
    left -= count;
  }
  return { offsets, spins, midHeight: (heights[0] + heights[1]) / 2 };
}

/** CPU mirror of the shaders' satellite position (earth-local) */
export function satellitePosition(
  centre: THREE.Vector3,
  offset: THREE.Vector3,
  spin: number,
  t: number,
  out = new THREE.Vector3()
): THREE.Vector3 {
  return out.copy(offset).applyAxisAngle(centre.clone().normalize(), spin * t).add(centre);
}

const SAT_GLSL = /* glsl */ `
  // Rodrigues rotation of v about unit axis k
  vec3 rotAxis(vec3 v, vec3 k, float a) {
    float c = cos(a), s = sin(a);
    return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
  }
  vec3 satPos(vec3 centre, vec3 offset, float spin) {
    return centre + rotAxis(offset, normalize(centre), spin * uOrbitT);
  }
`;

const COMMON_HEAD = /* glsl */ `
  attribute vec3 aColor;
  attribute float aStart;   // sim epoch ms
  attribute float aVisible;
  uniform float uTime;      // sim epoch ms
  uniform float uSpan;      // >=1, stretches short-lived effects at high playback speed
  uniform float uSel;       // selected instance index, -1 for none
  uniform float uHover;     // hovered instance index, -1 for none
  uniform float uSpread;    // 0..1 satellite launch animation
  uniform float uOrbitT;    // s, turns the satellite rings
  varying vec3 vColor;
  varying float vFade;
`;

function addInstanceAttribs(geo: THREE.BufferGeometry, stories: Story[]) {
  const n = stories.length;
  const start = new Float32Array(n);
  const color = new Float32Array(n * 3);
  const visible = new Float32Array(n).fill(1);
  stories.forEach((s, i) => {
    start[i] = s.publishedAt;
    color.set(langColorRGB(s.language), i * 3);
  });
  geo.setAttribute('aStart', new THREE.InstancedBufferAttribute(start, 1));
  geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(color, 3));
  geo.setAttribute('aVisible', new THREE.InstancedBufferAttribute(visible, 1));
}

function fillMatrices(mesh: THREE.InstancedMesh, stories: Story[], height: number) {
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const m = new THREE.Matrix4();
  const s = new THREE.Vector3(1, 1, 1);
  const phi = new THREE.Vector3();
  stories.forEach((st, i) => {
    const la = (st.lat * Math.PI) / 180;
    const lo = (st.lon * Math.PI) / 180;
    const cp = Math.cos(la);
    phi.set(cp * Math.cos(lo), Math.sin(la), -cp * Math.sin(lo));
    q.setFromUnitVectors(up, phi);
    pos.copy(phi).multiplyScalar(R * (1 + height));
    mesh.setMatrixAt(i, m.compose(pos, q, s));
  });
  mesh.instanceMatrix.needsUpdate = true;
}

export function makeStoryLayer(earthMesh: THREE.Object3D, stories: Story[]): StoryLayerHandle {
  const group = new THREE.Group();
  const uniforms: { value: number }[] = [];
  const uSpan = { value: 1 };
  const uSel = { value: -1 };
  const uHover = { value: -1 };
  const uSpread = { value: 0 };
  const uOrbitT = { value: 0 };
  const uViewH = { value: 800 };

  function register(
    geo: THREE.BufferGeometry,
    frag: string,
    vert: string,
    height: number,
    blending: THREE.Blending = THREE.AdditiveBlending
  ) {
    addInstanceAttribs(geo, stories);
    const uTime = { value: 0 };
    uniforms.push(uTime);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime, uSpan, uSel, uHover, uSpread, uOrbitT, uViewH },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending
    });
    const mesh = new THREE.InstancedMesh(geo, mat, stories.length);
    fillMatrices(mesh, stories, height);
    mesh.frustumCulled = false;
    mesh.raycast = () => {}; // picking is done analytically
    group.add(mesh);
    return mesh;
  }

  // ---- 1) dots: camera-facing quads (billboard in view space), constant
  // angular size so they stay legible at any zoom
  const n = stories.length;
  const dotGeo = new THREE.PlaneGeometry(1, 1);
  const aSpreadCentre = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
  const aSatOffset = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
  const aSatSpin = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
  const aSpreadOn = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
  for (const a of [aSpreadCentre, aSatOffset, aSatSpin, aSpreadOn]) a.setUsage(THREE.DynamicDrawUsage);
  dotGeo.setAttribute('aSpreadCentre', aSpreadCentre);
  dotGeo.setAttribute('aSatOffset', aSatOffset);
  dotGeo.setAttribute('aSatSpin', aSatSpin);
  dotGeo.setAttribute('aSpreadOn', aSpreadOn);
  const dotMesh = register(
    dotGeo,
    /* glsl */ `
      precision mediump float;
      varying vec3 vColor;
      varying float vFade;
      varying vec2 vUv;
      varying float vHi;
      void main() {
        float r = length(vUv - 0.5) * 2.0;     // 0 centre .. 1 edge
        if (r > 1.0) discard;
        float core = smoothstep(0.62, 0.48, r); // solid disc
        float ring = smoothstep(0.62, 0.70, r) * smoothstep(0.86, 0.72, r); // dark outline
        float halo = smoothstep(1.0, 0.6, r) * 0.35;
        vec3 col = mix(vColor, vec3(1.0), smoothstep(0.25, 0.0, r) * 0.55);
        // outline: dark normally, white when hovered/selected
        col = mix(col, vec3(vHi > 0.0 ? 1.0 : 0.0), ring * 0.85);
        float a = max(core, max(ring * 0.8, halo)) * vFade;
        gl_FragColor = vec4(col, a);
      }
    `,
    /* glsl */ `
      ${COMMON_HEAD}
      attribute vec3 aSpreadCentre;
      attribute vec3 aSatOffset;
      attribute float aSatSpin;
      attribute float aSpreadOn;
      uniform float uViewH;
      ${SAT_GLSL}
      varying vec2 vUv;
      varying float vHi;
      void main() {
        vColor = aColor;
        vUv = uv;
        float id = float(gl_InstanceID);
        float sp = aSpreadOn * uSpread;
        vHi = id == uSel ? 2.0 : (id == uHover ? 1.0 : 0.0);
        float age = (uTime - aStart) / 1000.0; // sim seconds
        float pop = smoothstep(0.0, 120.0 * uSpan, age);
        float flash = 1.0 + 0.8 * exp(-max(age, 0.0) / (900.0 * uSpan));
        float decay = 0.6 + 0.4 * exp(-max(age, 0.0) / 21600.0); // floor after ~6 sim-h
        vFade = step(0.0, age) * pop * (0.55 + 0.45 * decay) * aVisible;
        vec3 home = instanceMatrix[3].xyz;
        // launched satellites rise from their plotted spot into orbit
        vec3 p = sp > 0.0 ? mix(home, satPos(aSpreadCentre, aSatOffset, aSatSpin), sp) : home;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float dist = -mv.z;
        // world units per CSS px at this distance: 2 tan(fov/2) / height
        float pxWorld = 2.0 * dist / (projectionMatrix[1][1] * uViewH);
        float unit = max(${DOT_UNIT} * dist, ${DOT_MIN_PX.toFixed(1)} * pxWorld);
        float size = unit * (0.6 + 0.4 * pop) * flash * (0.7 + 0.3 * decay);
        if (vHi > 0.0) { size *= 1.0 + 0.4 * vHi; vFade = max(vFade, step(0.0, age) * aVisible); }
        if (sp > 0.0) { size = mix(size, min(max(size, unit * 0.85), ${SAT_MAX_DOT}), sp); vFade = max(vFade, sp * step(0.0, age) * aVisible); }
        // while a cluster is fanned out, everything else steps back
        else vFade *= 1.0 - 0.75 * uSpread;
        // nudge toward the camera (along the view ray, so screen position is
        // unchanged) so the quad isn't clipped by the globe
        mv.xyz -= normalize(mv.xyz) * size * 0.5;
        mv.xy += position.xy * size;
        gl_Position = projectionMatrix * mv;
      }
    `,
    0.002,
    THREE.NormalBlending
  );

  // ---- 2) beams: thin boxes rising from the surface
  {
    const box = new THREE.BoxGeometry(0.003, 1, 0.003);
    box.translate(0, 0.5, 0); // base at origin, unit height
    register(
      box,
      /* glsl */ `
        precision mediump float;
        varying vec3 vColor;
        varying float vFade;
        void main() {
          gl_FragColor = vec4(vColor, vFade * 0.9);
        }
      `,
      /* glsl */ `
        ${COMMON_HEAD}
        void main() {
          vColor = aColor;
          float age = (uTime - aStart) / 1000.0;
          float rise = smoothstep(0.0, 600.0 * uSpan, age);   // ~10 sim-minutes
          float decay = exp(-max(age, 0.0) / (9000.0 * uSpan)); // ~2.5 sim-hours
          vFade = step(0.0, age) * rise * decay * 0.85 * aVisible * (1.0 - 0.85 * uSpread); // step back while satellites are up
          float h = 0.06 * rise;
          vec3 p = position;
          p.y *= h;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
        }
      `,
      0.0
    );
  }

  // ---- 3) ripples: rings expanding on the surface for ~10 sim-minutes
  {
    const ring = new THREE.RingGeometry(0.7, 1, 24);
    ring.rotateX(-Math.PI / 2); // lie in xz, normal +y
    register(
      ring,
      /* glsl */ `
        precision mediump float;
        varying vec3 vColor;
        varying float vFade;
        void main() {
          gl_FragColor = vec4(vColor, vFade * 0.9);
        }
      `,
      /* glsl */ `
        ${COMMON_HEAD}
        void main() {
          vColor = aColor;
          float age = (uTime - aStart) / 1000.0;
          float life = clamp(age / (600.0 * uSpan), 0.0, 1.0); // 10 sim-minutes
          vFade = step(0.0, age) * (1.0 - life) * aVisible * (1.0 - 0.85 * uSpread); // step back while satellites are up
          float s = 0.05 * smoothstep(0.0, 1.0, life);
          vec3 p = position;
          p.xz *= s;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
        }
      `,
      0.001
    );
  }

  // ---- 4) satellite tethers + ground ticks (rebuilt per cluster, ≤ ~60 members)
  const lineMat = new THREE.ShaderMaterial({
    uniforms: { uSpread, uOrbitT },
    vertexShader: /* glsl */ `
      attribute vec3 aCentre;
      attribute vec3 aOffset;
      attribute float aSpin;
      attribute float aEnd;   // 0 = plotted location, 1 = satellite
      attribute vec3 aColor;
      uniform float uSpread;
      uniform float uOrbitT;
      ${SAT_GLSL}
      varying vec3 vColor;
      varying float vEnd;
      void main() {
        vColor = aColor;
        vEnd = aEnd;
        vec3 p = mix(position, satPos(aCentre, aOffset, aSpin), aEnd * uSpread);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = 5.0;
      }
    `,
    // no precision override here: uniforms are shared with the vertex stage,
    // and mismatched uniform precisions fail to link
    fragmentShader: /* glsl */ `
      uniform float uSpread;
      varying vec3 vColor;
      varying float vEnd;
      void main() {
        // tethers fade toward the ground so the stack reads as floating
        float a = 0.85 * uSpread * mix(0.35, 1.0, vEnd);
        gl_FragColor = vec4(mix(vColor, vec3(1.0), 0.35), a);
      }
    `,
    transparent: true,
    depthWrite: false
  });
  const lines = new THREE.LineSegments(new THREE.BufferGeometry(), lineMat);
  const ticks = new THREE.Points(new THREE.BufferGeometry(), lineMat);
  for (const o of [lines, ticks]) {
    o.frustumCulled = false;
    o.visible = false;
    o.renderOrder = 2; // after the dots so lines read on top of the globe
    group.add(o);
  }
  dotMesh.renderOrder = 3;
  let spreadMembers: number[] = [];
  const homeMat = new THREE.Matrix4();

  const visibleAttrs = group.children.filter((c) => c instanceof THREE.InstancedMesh).map(
    (c) => (c as THREE.Mesh).geometry.getAttribute('aVisible') as THREE.BufferAttribute
  );

  earthMesh.add(group);
  group.position.set(0, 0, 0);

  return {
    group,
    setTime(simMs: number) {
      for (const u of uniforms) u.value = simMs;
    },
    setHighlight(selected: number, hovered: number) {
      uSel.value = selected;
      uHover.value = hovered;
    },
    setSpread(members: number[]) {
      for (const i of spreadMembers) aSpreadOn.array[i] = 0;
      spreadMembers = members;
      lines.visible = ticks.visible = members.length > 0;
      if (!members.length) {
        aSpreadOn.needsUpdate = true;
        return null;
      }
      const own = members.map((i) => {
        const m = new THREE.Matrix4();
        dotMesh.getMatrixAt(i, m);
        return new THREE.Vector3().setFromMatrixPosition(m);
      });
      const centre = own
        .reduce((acc, v) => acc.add(v), new THREE.Vector3())
        .normalize()
        .multiplyScalar(R * 1.002);
      const { offsets, spins, midHeight } = satelliteLayout(members.length, centre);
      const k = members.length;
      const lp = new Float32Array(k * 6);
      const lc = new Float32Array(k * 6);
      const lo = new Float32Array(k * 6);
      const lsp = new Float32Array(k * 2);
      const le = new Float32Array(k * 2);
      const lcol = new Float32Array(k * 6);
      members.forEach((i, j) => {
        centre.toArray(aSpreadCentre.array, i * 3);
        offsets[j].toArray(aSatOffset.array, i * 3);
        aSatSpin.array[i] = spins[j];
        aSpreadOn.array[i] = 1;
        const rgb = langColorRGB(stories[i].language);
        for (let e = 0; e < 2; e++) {
          const v = j * 2 + e;
          own[j].toArray(lp, v * 3);
          centre.toArray(lc, v * 3);
          offsets[j].toArray(lo, v * 3);
          lsp[v] = spins[j];
          le[v] = e;
          lcol.set(rgb, v * 3);
        }
      });
      aSpreadCentre.needsUpdate = aSatOffset.needsUpdate = aSatSpin.needsUpdate = true;
      aSpreadOn.needsUpdate = true;
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
      lg.setAttribute('aCentre', new THREE.BufferAttribute(lc, 3));
      lg.setAttribute('aOffset', new THREE.BufferAttribute(lo, 3));
      lg.setAttribute('aSpin', new THREE.BufferAttribute(lsp, 1));
      lg.setAttribute('aEnd', new THREE.BufferAttribute(le, 1));
      lg.setAttribute('aColor', new THREE.BufferAttribute(lcol, 3));
      lines.geometry.dispose();
      lines.geometry = lg;
      // ticks mark each plotted location: the aEnd = 0 vertex of every tether
      const tg = new THREE.BufferGeometry();
      for (const name of ['position', 'aCentre', 'aOffset', 'aSpin', 'aEnd', 'aColor'])
        tg.setAttribute(name, lg.getAttribute(name));
      tg.setIndex(members.map((_, j) => j * 2));
      ticks.geometry.dispose();
      ticks.geometry = tg;
      return { members, centre, offsets, spins, midHeight };
    },
    setSpreadAmount(v: number) {
      uSpread.value = v;
    },
    setOrbitTime(seconds: number) {
      uOrbitT.value = seconds;
    },
    getHome(index: number, out: THREE.Vector3) {
      dotMesh.getMatrixAt(index, homeMat);
      return out.setFromMatrixPosition(homeMat);
    },
    setViewHeight(px: number) {
      uViewH.value = Math.max(1, px);
    },
    setTimeScale(speed: number) {
      // sublinear so the intro (~50,000x) gets ~30x longer effects, not 170x
      uSpan.value = Math.pow(Math.max(1, speed / 300), 0.65);
    },
    setVisibility(mask: Uint8Array) {
      visibleAttrs.forEach((attr) => {
        (attr.array as Float32Array).set(mask as unknown as number[]);
        attr.needsUpdate = true;
      });
    },
    dispose() {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) (m.material as THREE.Material).dispose();
      });
      earthMesh.remove(group);
    }
  };
}
