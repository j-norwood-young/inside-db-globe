import * as THREE from 'three';

/**
 * Fresnel rim atmosphere shell (back-side, additive). Warm on the day side,
 * cool blue at night.
 */
export function makeAtmosphereMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec3 vNormalV;
      varying vec3 vPosV;
      void main() {
        vNormalV = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vPosV = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uSunDirV;
      varying vec3 vNormalV;
      varying vec3 vPosV;
      void main() {
        vec3 n = normalize(vNormalV);
        vec3 v = normalize(-vPosV);
        float rim = pow(1.0 - abs(dot(n, v)), 2.6);
        float lit = smoothstep(-0.3, 0.35, dot(n, uSunDirV));
        vec3 dayCol = vec3(0.35, 0.62, 1.0);
        vec3 nightCol = vec3(0.06, 0.10, 0.24);
        gl_FragColor = vec4(mix(nightCol, dayCol, lit) * rim, rim);
      }
    `,
    uniforms: { uSunDirV: { value: new THREE.Vector3(1, 0, 0) } },
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending
  });
}
