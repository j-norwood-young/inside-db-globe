import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalV; // view space
varying vec3 vPosV;    // view space

void main() {
  vUv = uv;
  vNormalV = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vPosV = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
precision highp float;

uniform sampler2D uDayMap;
uniform sampler2D uNightMap;
uniform sampler2D uSpecMap;    // water mask
uniform sampler2D uNormalMap;
uniform vec3 uSunDirV;         // unit, VIEW space (scene updates per frame)
uniform float uTexLonOffset;   // rad, texture alignment nudge
uniform float uNightBoost;
uniform float uDayBrightness;  // day-map grade: <1 darkens
uniform float uDaySaturation;  // <1 mutes colour
uniform vec3 uLandTint;        // warm multiply on land: browner deserts, olive forests
uniform float uLandGamma;      // >1 deepens land midtones
uniform vec3 uOceanTint;       // cool multiply on water: deeper navy

varying vec2 vUv;
varying vec3 vNormalV;
varying vec3 vPosV;

void main() {
  // no fract(): textures use RepeatWrapping, and a wrap inside a triangle
  // would blow up the UV derivatives and show a dashed seam at the dateline
  vec2 uv = vec2(vUv.x + uTexLonOffset / 6.283185307179586, vUv.y);

  // Day/night uses the smooth geometric normal so the terminator is a clean
  // great-circle band; the normal map only shapes the ocean glint.
  vec3 n0 = normalize(vNormalV);
  vec3 dpx = dFdx(vPosV);
  vec3 dpy = dFdy(vPosV);
  vec3 t1 = normalize(dpx - n0 * dot(dpx, n0));
  vec3 t2 = cross(n0, t1);
  vec3 nm = texture2D(uNormalMap, uv).xyz * 2.0 - 1.0;
  vec3 n = normalize(n0 + (t1 * nm.x + t2 * nm.y) * 0.35);

  float d = dot(n0, uSunDirV);

  vec3 day = texture2D(uDayMap, uv).rgb;
  day = mix(vec3(dot(day, vec3(0.2126, 0.7152, 0.0722))), day, uDaySaturation) * uDayBrightness;
  float waterMask = texture2D(uSpecMap, uv).r;
  day = mix(pow(day, vec3(uLandGamma)) * uLandTint, day * uOceanTint, waterMask);
  vec3 night = texture2D(uNightMap, uv).rgb;
  float water = texture2D(uSpecMap, uv).r;

  // gentle Lambert falloff with a high floor so the whole day hemisphere reads bright
  float sunLight = smoothstep(-0.05, 0.25, d);
  vec3 dayLit = day * (0.55 + 0.75 * clamp(d, 0.0, 1.0)) * 1.25;

  // city lights only where it is properly dark (no muddy overlap with daylight)
  float nightMix = smoothstep(0.02, -0.12, d);
  vec3 nightLit = night * uNightBoost * 1.6 * nightMix;

  vec3 color = dayLit * sunLight + nightLit;

  // ocean glint (Blinn half-vector, view space)
  vec3 viewDir = normalize(-vPosV);
  vec3 halfV = normalize(uSunDirV + viewDir);
  float spec = pow(max(dot(n, halfV), 0.0), 60.0) * water * sunLight;
  color += vec3(1.0, 0.97, 0.92) * spec * 0.6;

  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}
`;

export function makeEarthMaterial(
  dayTex: THREE.Texture,
  nightTex: THREE.Texture,
  specTex: THREE.Texture,
  normalTex: THREE.Texture
): THREE.ShaderMaterial {
  for (const t of [dayTex, nightTex, specTex, normalTex]) t.wrapS = THREE.RepeatWrapping;
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uDayMap: { value: dayTex },
      uNightMap: { value: nightTex },
      uSpecMap: { value: specTex },
      uNormalMap: { value: normalTex },
      uSunDirV: { value: new THREE.Vector3(1, 0, 0) },
      uTexLonOffset: { value: 0 },
      uNightBoost: { value: 1.0 },
      uDayBrightness: { value: 0.7 },
      uDaySaturation: { value: 0.7 },
      uLandTint: { value: new THREE.Vector3(1.0, 0.8, 0.58) },
      uLandGamma: { value: 1.25 },
      uOceanTint: { value: new THREE.Vector3(0.74, 0.83, 1.0) }
    }
  });
}
