import * as THREE from 'three';

/**
 * Compact solar position (Meeus "Astronomical Algorithms", low-precision
 * formulae valid for 1900–2100) → unit vector from Earth's centre to the
 * sun in the Earth-Centred Earth-Fixed (ECEF) frame for a sim timestamp.
 *
 * Also returns the Greenwich mean sidereal angle so the globe mesh can
 * rotate in lockstep — with both derived from `t`, the terminator can never
 * desync from the continents.
 */
const DEG = Math.PI / 180;
const J2000 = Date.UTC(2000, 0, 1, 12); // epoch ms of JD 2451545.0

export interface SunState {
  dir: THREE.Vector3; // unit, ECEF in three.js axes (x = 0°E, y = north, −z = 90°E)
  gmst: number; // rad, rotation of Earth about its axis at time t
}

export function sunState(tEpochMs: number): SunState {
  const d = (tEpochMs - J2000) / 86400000; // days since J2000.0
  const L = (280.46 + 0.9856474 * d) % 360; // mean longitude
  const g = (357.528 + 0.9856003 * d) % 360; // mean anomaly
  const gl = g * DEG;
  const lambda = L * DEG + 1.915 * DEG * Math.sin(gl) + 0.02 * DEG * Math.sin(2 * gl);
  const eps = (23.439 - 0.0000004 * d) * DEG;

  // sun direction in equatorial frame
  const xEq = Math.cos(lambda);
  const yEq = Math.cos(eps) * Math.sin(lambda);
  const zEq = Math.sin(eps) * Math.sin(lambda);

  // Greenwich mean sidereal time (rad)
  const gmst = ((280.46061837 + 360.98564736629 * d) % 360) * DEG;

  // rotate equatorial → ECEF by GMST (X = x·cosθ + y·sinθ; Y = −x·sinθ + y·cosθ),
  // then map right-handed ECEF (X, Y, Z) → three.js (X, Z, −Y)
  const c = Math.cos(gmst);
  const s = Math.sin(gmst);
  const dir = new THREE.Vector3(xEq * c + yEq * s, zEq, xEq * s - yEq * c).normalize();
  return { dir, gmst };
}

/**
 * Convert lat/lon (deg) to a unit vector in the mesh-local ECEF convention
 * used by three.js SphereGeometry + an equirectangular texture: x at lon 0°,
 * −z at lon 90°E, +y at north pole (right-handed, so the map is not mirrored).
 */
export function latLonToDir(latDeg: number, lonDeg: number, out = new THREE.Vector3()): THREE.Vector3 {
  const phi = latDeg * DEG;
  const lam = lonDeg * DEG;
  const cp = Math.cos(phi);
  return out.set(cp * Math.cos(lam), Math.sin(phi), -cp * Math.sin(lam));
}
