import * as THREE from 'three';

/** Static starfield on a large sphere; subtle per-star brightness variation. */
export function makeStarfield(count = 3500, radius = 300): THREE.Points {
  const pos = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const shade = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // uniform on sphere
    const u = Math.random() * 2 - 1;
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    pos[i * 3] = r * Math.cos(a) * radius;
    pos[i * 3 + 1] = u * radius;
    pos[i * 3 + 2] = r * Math.sin(a) * radius;
    size[i] = Math.random() < 0.06 ? 1.8 + Math.random() * 1.6 : 0.7 + Math.random() * 0.9;
    const b = 0.35 + Math.random() * 0.65;
    const w = 1 + (Math.random() - 0.5) * 0.14; // slight colour temperature
    shade[i * 3] = b * w;
    shade[i * 3 + 1] = b;
    shade[i * 3 + 2] = b * (1.1 + (Math.random() - 0.5) * 0.18);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aShade', new THREE.BufferAttribute(shade, 3));

  const m = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute vec3 aShade;
      varying vec3 vShade;
      void main() {
        vShade = aShade;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize;
      }
    `,
    fragmentShader: /* glsl */ `
      precision mediump float;
      varying vec3 vShade;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.12, length(c));
        gl_FragColor = vec4(vShade, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  return pts;
}
