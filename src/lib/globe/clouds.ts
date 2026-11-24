import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalV;
varying vec3 vPosV;
void main() {
  vUv = uv;
  vNormalV = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vPosV = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

export function makeCloudMaterial(cloudTex: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D uCloudMap;
      uniform vec3 uSunDirV;
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vPosV;
      void main() {
        float c = texture2D(uCloudMap, vUv).r; // greyscale cloud cover
        if (c < 0.01) discard;
        float d = dot(normalize(vNormalV), uSunDirV);
        float lit = smoothstep(-0.12, 0.25, d);
        vec3 col = mix(vec3(0.02, 0.03, 0.05), vec3(1.0), lit);
        float alpha = c * (0.25 + 0.75 * lit);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    uniforms: {
      uCloudMap: { value: cloudTex },
      uSunDirV: { value: new THREE.Vector3(1, 0, 0) }
    },
    transparent: true,
    depthWrite: false
  });
}
