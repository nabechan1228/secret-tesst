import * as THREE from 'three';
import { horizonToCartesian, getScreenPosition } from './calculations';
import { DOME_RADIUS } from './constants';

function gradEstimate(h: number, camera: THREE.PerspectiveCamera): number {
  if (!camera) return h * 0.25;
  const pixPerDeg = h / camera.fov;
  return pixPerDeg * 20;
}

export function drawLightPollution(
  ctx2d: CanvasRenderingContext2D,
  w: number,
  h: number,
  isForceNightMode: boolean,
  isSolarEclipse: boolean,
  eclipseRatio: number,
  viewAzimuth: number,
  camera: THREE.PerspectiveCamera,
  overlayCanvas: HTMLCanvasElement,
  bortleScale: number,
  sunAlt: number
) {
  const effectiveSunAlt = isForceNightMode ? -20 : sunAlt;
  let sunFade = 1.0;
  if (effectiveSunAlt > -8) {
    sunFade = Math.max(0.0, 1.0 - (effectiveSunAlt + 8) / 8.0);
  }

  // 日食が進行している時は、食の割合に応じて空の明るさを強制的に下げる
  let eclipseFade = 1.0;
  if (isSolarEclipse) {
    // 完全に重なると空はほぼ夜になる (皆既日食)
    eclipseFade = Math.max(0.02, 1.0 - eclipseRatio * 0.98);
  }

  // 新宿などの都会での夜間光害スカイグロー (昼間・薄明時は太陽光にかき消されるため sunFade が十分に低いときに適用)
  if (bortleScale >= 2 && sunFade < 0.15) {
    ctx2d.save();
    // 都会であるほど明るい青白・茶色グローが空全体にかかり、星空のコントラストが落ちる
    const glowAlpha = ((bortleScale - 1) / 8.0) * 0.14 * (1.0 - sunFade);
    ctx2d.fillStyle = `rgba(180, 195, 230, ${glowAlpha})`;
    ctx2d.fillRect(0, 0, w, h);
    ctx2d.restore();
  }

  if (sunFade * eclipseFade <= 0.01) return;

  const horizonAzimuths = [0, 45, 90, 135, 180, 225, 270, 315];
  const horizonScreenY: number[] = [];

  for (const az of horizonAzimuths) {
    const pos3d = horizonToCartesian(az, 0.01, DOME_RADIUS);
    const scr = getScreenPosition(pos3d, camera, overlayCanvas);
    if (scr.visible) horizonScreenY.push(scr.y);
  }

  if (horizonScreenY.length === 0) return;

  const baseY = Math.max(...horizonScreenY);
  if (baseY >= h) return;

  const fadeThreshold = h * 0.80;
  const fadeAlpha = baseY < fadeThreshold
    ? 1.0
    : 1.0 - (baseY - fadeThreshold) / (h - fadeThreshold);

  if (fadeAlpha <= 0.01) return;

  const pos20 = horizonToCartesian(viewAzimuth, 20, DOME_RADIUS);
  const scr20 = getScreenPosition(pos20, camera, overlayCanvas);
  const alt20Y = scr20.visible ? scr20.y : baseY - Math.min(gradEstimate(h, camera), baseY - 20);

  const gradHeight = Math.max(80, baseY - alt20Y);

  ctx2d.save();
  ctx2d.globalAlpha = fadeAlpha * sunFade * eclipseFade;

  {
    const grad = ctx2d.createLinearGradient(0, baseY, 0, baseY - gradHeight);
    grad.addColorStop(0.00, 'rgba(180, 200, 230, 0.28)');
    grad.addColorStop(0.15, 'rgba(130, 160, 195, 0.18)');
    grad.addColorStop(0.35, 'rgba( 80, 110, 160, 0.12)');
    grad.addColorStop(0.60, 'rgba( 40,  60, 120, 0.06)');
    grad.addColorStop(0.85, 'rgba( 15,  25,  70, 0.02)');
    grad.addColorStop(1.00, 'rgba(  5,  10,  40, 0.00)');
    ctx2d.fillStyle = grad;
    ctx2d.fillRect(0, baseY - gradHeight, w, gradHeight + (h - baseY) + 10);
  }

  {
    const cx = w * 0.5;
    const cy = baseY + 20;
    const rx = w * 0.55;
    const ry = gradHeight * 0.40;

    ctx2d.save();
    ctx2d.scale(1.0, ry / rx);
    const haloGrad = ctx2d.createRadialGradient(
      cx, cy * (rx / ry), 0,
      cx, cy * (rx / ry), rx
    );
    haloGrad.addColorStop(0.0,  'rgba(215, 230, 255, 0.10)');
    haloGrad.addColorStop(0.35, 'rgba(170, 195, 235, 0.05)');
    haloGrad.addColorStop(0.70, 'rgba(120, 150, 200, 0.02)');
    haloGrad.addColorStop(1.0,  'rgba(80,  110, 160, 0.00)');
    ctx2d.fillStyle = haloGrad;
    ctx2d.fillRect(0, (cy - ry) * (rx / ry), w, ry * 2.5 * (rx / ry));
    ctx2d.restore();
  }

  ctx2d.restore();
}

export function drawClouds(
  ctx2d: CanvasRenderingContext2D,
  w: number,
  h: number,
  currentCloudCover: number,
  currentDate: Date
) {
  if (currentCloudCover <= 5) return;

  ctx2d.save();
  const baseOpacity = (currentCloudCover / 100) * 0.35;
  const time = currentDate.getTime() * 0.00002;

  const numClouds = 8;
  for (let i = 0; i < numClouds; i++) {
    const seed = i * 1.7;
    const cx = ((Math.sin(time * 0.5 + seed) * 0.4 + 0.5) * w);
    const cy = ((Math.cos(time * 0.3 + seed * 1.2) * 0.3 + 0.4) * h);
    const r = (0.2 + 0.25 * (Math.sin(time * 0.2 + seed) * 0.5 + 0.5)) * Math.min(w, h);

    const grad = ctx2d.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
    grad.addColorStop(0.0, `rgba(235, 240, 250, ${baseOpacity})`);
    grad.addColorStop(0.4, `rgba(220, 225, 235, ${baseOpacity * 0.7})`);
    grad.addColorStop(0.8, `rgba(200, 210, 225, ${baseOpacity * 0.25})`);
    grad.addColorStop(1.0, 'rgba(200, 210, 225, 0)');

    ctx2d.fillStyle = grad;
    ctx2d.beginPath();
    ctx2d.arc(cx, cy, r, 0, Math.PI * 2);
    ctx2d.fill();
  }

  ctx2d.restore();
}

export function drawMoonMapOverlay(
  ctx2d: CanvasRenderingContext2D,
  w: number,
  h: number,
  showMoonMap: boolean,
  observationMode: string,
  activeTrackPlanet: string | null,
  dsoPhotoObjects: Map<string, THREE.Sprite>,
  camera: THREE.PerspectiveCamera
) {
  if (!showMoonMap || observationMode !== 'telescope' || activeTrackPlanet !== 'Moon') return;
  
  const moonSprite = dsoPhotoObjects.get('Moon');
  if (!moonSprite || !moonSprite.visible) return;
  
  const pos = new THREE.Vector3();
  moonSprite.getWorldPosition(pos);
  
  const tempPos = pos.clone().project(camera);
  if (tempPos.z > 1.0) return; 
  
  const centerX = (tempPos.x * 0.5 + 0.5) * w;
  const centerY = (-tempPos.y * 0.5 + 0.5) * h;
  
  const dist = camera.position.distanceTo(pos);
  const fovRad = (camera.fov * Math.PI) / 180;
  const moon3dRadius = 8.7 * 0.5; 
  const moonScreenRadius = (moon3dRadius / (dist * Math.tan(fovRad * 0.5))) * (h * 0.5);
  
  if (moonScreenRadius < 15) return;
  
  const MOON_FEATURES = [
    { name: 'コペルニクス (Copernicus)', x: -0.25, y: 0.15 },
    { name: 'ティコ (Tycho)', x: -0.1, y: -0.6 },
    { name: 'ケプラー (Kepler)', x: -0.48, y: 0.08 },
    { name: 'プラトン (Plato)', x: -0.1, y: 0.65 },
    { name: '雨の海 (Mare Imbrium)', x: -0.2, y: 0.38 },
    { name: '静かの海 (Tranquillitatis)', x: 0.35, y: 0.12 },
    { name: '晴れの海 (Mare Serenitatis)', x: 0.18, y: 0.32 },
    { name: '危機の海 (Mare Crisium)', x: 0.62, y: 0.18 },
    { name: '豊かの海 (Mare Fecunditatis)', x: 0.58, y: -0.12 },
    { name: '神酒の海 (Mare Nectaris)', x: 0.38, y: -0.28 },
    { name: '嵐の大洋 (Procellarum)', x: -0.58, y: 0.02 },
    { name: '雲の海 (Mare Nubium)', x: -0.22, y: -0.38 }
  ];
  
  ctx2d.save();
  ctx2d.font = "9px 'Outfit', sans-serif";
  ctx2d.textBaseline = "middle";
  
  MOON_FEATURES.forEach(f => {
    const fx = centerX + f.x * moonScreenRadius;
    const fy = centerY - f.y * moonScreenRadius; 
    
    if (fx < 0 || fx > w || fy < 0 || fy > h) return;
    
    ctx2d.strokeStyle = 'rgba(0, 255, 204, 0.45)';
    ctx2d.lineWidth = 1;
    ctx2d.beginPath();
    ctx2d.arc(fx, fy, 2, 0, Math.PI * 2);
    ctx2d.stroke();
    
    const textOffset = f.x >= 0 ? 10 : -10;
    const textAlign = f.x >= 0 ? 'left' : 'right';
    ctx2d.textAlign = textAlign;
    
    ctx2d.beginPath();
    ctx2d.moveTo(fx, fy);
    ctx2d.lineTo(fx + textOffset, fy - 6);
    ctx2d.lineTo(fx + textOffset + (f.x >= 0 ? 15 : -15), fy - 6);
    ctx2d.stroke();
    
    ctx2d.fillStyle = 'rgba(0,0,0,0.85)';
    ctx2d.fillText(f.name, fx + textOffset + (f.x >= 0 ? 17 : -17) + 1, fy - 5);
    ctx2d.fillStyle = 'rgba(0, 255, 204, 0.9)';
    ctx2d.fillText(f.name, fx + textOffset + (f.x >= 0 ? 17 : -17), fy - 6);
  });
  
  ctx2d.restore();
}

export function drawObservationMask(
  ctx2d: CanvasRenderingContext2D,
  w: number,
  h: number,
  observationMode: string,
  camera: THREE.PerspectiveCamera
) {
  if (observationMode === 'none') return;

  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) * 0.41;

  ctx2d.save();

  ctx2d.beginPath();
  ctx2d.rect(0, 0, w, h);
  ctx2d.arc(cx, cy, radius, 0, Math.PI * 2, true);
  ctx2d.fillStyle = 'rgba(2, 3, 10, 0.98)';
  ctx2d.fill();

  const grad = ctx2d.createRadialGradient(cx, cy, radius - 20, cx, cy, radius + 2);
  grad.addColorStop(0, 'rgba(2, 3, 10, 0)');
  grad.addColorStop(0.5, 'rgba(2, 3, 10, 0.4)');
  grad.addColorStop(1, 'rgba(2, 3, 10, 0.98)');
  
  ctx2d.beginPath();
  ctx2d.arc(cx, cy, radius + 5, 0, Math.PI * 2);
  ctx2d.fillStyle = grad;
  ctx2d.fill();

  ctx2d.strokeStyle = 'rgba(80, 100, 140, 0.25)';
  ctx2d.lineWidth = 2.0;
  ctx2d.beginPath();
  ctx2d.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx2d.stroke();

  if (observationMode === 'binoculars') {
    ctx2d.font = "11px 'Courier New', monospace";
    ctx2d.fillStyle = 'rgba(0, 188, 212, 0.6)';
    ctx2d.textAlign = 'center';
    ctx2d.textBaseline = 'bottom';
    const tfov = camera.fov.toFixed(1);
    ctx2d.fillText(`BINOCULARS 7x50 | TFOV: ${tfov}°`, cx, cy + radius - 15);
  } else if (observationMode === 'telescope') {
    ctx2d.strokeStyle = 'rgba(255, 71, 87, 0.35)';
    ctx2d.lineWidth = 1.0;

    const circles = [radius * 0.12, radius * 0.35, radius * 0.65];
    circles.forEach(r => {
      ctx2d.beginPath();
      ctx2d.arc(cx, cy, r, 0, Math.PI * 2);
      ctx2d.stroke();
    });

    const innerGap = 8;
    ctx2d.beginPath();
    ctx2d.moveTo(cx - radius, cy);
    ctx2d.lineTo(cx - innerGap, cy);
    ctx2d.moveTo(cx + innerGap, cy);
    ctx2d.lineTo(cx + radius, cy);
    ctx2d.moveTo(cx, cy - radius);
    ctx2d.lineTo(cx, cy - innerGap);
    ctx2d.moveTo(cx, cy + innerGap);
    ctx2d.lineTo(cx, cy + radius);
    ctx2d.stroke();

    const tickCount = 10;
    const tickSpacing = radius / tickCount;
    ctx2d.lineWidth = 0.8;
    for (let i = 1; i < tickCount; i++) {
      const dist = i * tickSpacing;
      if (dist < innerGap) continue;
      ctx2d.beginPath(); ctx2d.moveTo(cx - dist, cy - 3); ctx2d.lineTo(cx - dist, cy + 3); ctx2d.stroke();
      ctx2d.beginPath(); ctx2d.moveTo(cx + dist, cy - 3); ctx2d.lineTo(cx + dist, cy + 3); ctx2d.stroke();
      ctx2d.beginPath(); ctx2d.moveTo(cx - 3, cy - dist); ctx2d.lineTo(cx + 3, cy - dist); ctx2d.stroke();
      ctx2d.beginPath(); ctx2d.moveTo(cx - 3, cy + dist); ctx2d.lineTo(cx + 3, cy + dist); ctx2d.stroke();
    }

    ctx2d.font = "11px 'Courier New', monospace";
    ctx2d.fillStyle = 'rgba(255, 71, 87, 0.6)';
    ctx2d.textAlign = 'center';
    ctx2d.textBaseline = 'bottom';
    const tfov = camera.fov.toFixed(2);
    ctx2d.fillText(`TELESCOPE D200mm f1000mm | TFOV: ${tfov}° | RETICLE ON`, cx, cy + radius - 15);
  }

  ctx2d.restore();
}
