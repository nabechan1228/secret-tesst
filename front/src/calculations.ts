import * as THREE from 'three';

export function getJulianDate(date: Date): number {
  const y = date.getUTCFullYear();
  let m = date.getUTCMonth() + 1;
  const d = date.getUTCDate() +
            date.getUTCHours() / 24.0 +
            date.getUTCMinutes() / 1440.0 +
            date.getUTCSeconds() / 86400.0;
  let year = y;
  if (m <= 2) { year -= 1; m += 12; }
  const a = Math.floor(year / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (year + 4716)) + Math.floor(30.6001 * (m + 1)) + d + b - 1524.5;
}

export function getLocalSiderealTime(jd: number, lng: number): number {
  const t = (jd - 2451545.0) / 36525.0;
  let gmst = 280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * t * t - (t * t * t) / 38710000.0;
  gmst = ((gmst % 360.0) + 360.0) % 360.0;
  return ((gmst + lng) % 360.0 + 360.0) % 360.0;
}

export function equatorialToHorizontal(
  ra: number,
  dec: number,
  lstDeg: number,
  latDeg: number
): { az: number; alt: number } {
  const haDeg = lstDeg - (ra * 15.0);
  const ha = haDeg * Math.PI / 180.0;
  const decRad = dec * Math.PI / 180.0;
  const lat = latDeg * Math.PI / 180.0;
  let sinAlt = Math.sin(lat) * Math.sin(decRad) + Math.cos(lat) * Math.cos(decRad) * Math.cos(ha);
  sinAlt = Math.max(-1.0, Math.min(1.0, sinAlt));
  const alt = Math.asin(sinAlt);
  const y = -Math.sin(ha) * Math.cos(decRad);
  const x = Math.cos(lat) * Math.sin(decRad) - Math.sin(lat) * Math.cos(decRad) * Math.cos(ha);
  let az = Math.atan2(y, x);
  if (az < 0) az += 2 * Math.PI;
  return { az: az * 180.0 / Math.PI, alt: alt * 180.0 / Math.PI };
}

export function horizonToCartesian(azDeg: number, altDeg: number, radius: number): THREE.Vector3 {
  const az = azDeg * Math.PI / 180.0;
  const alt = altDeg * Math.PI / 180.0;
  return new THREE.Vector3(
    radius * Math.cos(alt) * Math.sin(az),
    radius * Math.sin(alt),
    -radius * Math.cos(alt) * Math.cos(az)
  );
}

const tempV = new THREE.Vector3();
export function getScreenPosition(
  pos3d: THREE.Vector3,
  camera: THREE.PerspectiveCamera,
  overlayCanvas: HTMLCanvasElement
): { x: number; y: number; visible: boolean } {
  tempV.copy(pos3d);
  tempV.project(camera);
  if (tempV.z > 1 || Math.abs(tempV.x) > 1 || Math.abs(tempV.y) > 1) {
    return { x: 0, y: 0, visible: false };
  }
  return {
    x: (tempV.x * 0.5 + 0.5) * overlayCanvas.width,
    y: (tempV.y * -0.5 + 0.5) * overlayCanvas.height,
    visible: true
  };
}
