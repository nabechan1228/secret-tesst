import * as THREE from 'three';

const textureCache: Map<string, THREE.Texture> = new Map();

export function createStarTexture(color: string): THREE.Texture {
  if (textureCache.has(color)) return textureCache.get(color)!;

  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);

  // 外側の大きなグロー
  const outerGlow = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  outerGlow.addColorStop(0.0,  `rgba(255, 255, 255, 0.0)`);
  outerGlow.addColorStop(0.3,  `rgba(${r}, ${g}, ${b}, 0.0)`);
  outerGlow.addColorStop(0.55, `rgba(${r}, ${g}, ${b}, 0.08)`);
  outerGlow.addColorStop(0.75, `rgba(${r}, ${g}, ${b}, 0.18)`);
  outerGlow.addColorStop(0.88, `rgba(${r}, ${g}, ${b}, 0.35)`);
  outerGlow.addColorStop(1.0,  `rgba(0, 0, 0, 0)`);
  ctx.fillStyle = outerGlow;
  ctx.fillRect(0, 0, 128, 128);

  // 内側の輝点
  const innerGrad = ctx.createRadialGradient(64, 64, 0, 64, 64, 32);
  innerGrad.addColorStop(0.0,  `rgba(255, 255, 255, 1.0)`);
  innerGrad.addColorStop(0.08, `rgba(255, 255, 255, 1.0)`);
  innerGrad.addColorStop(0.2,  `rgba(${r}, ${g}, ${b}, 0.9)`);
  innerGrad.addColorStop(0.45, `rgba(${r}, ${g}, ${b}, 0.5)`);
  innerGrad.addColorStop(0.75, `rgba(${r}, ${g}, ${b}, 0.1)`);
  innerGrad.addColorStop(1.0,  `rgba(0, 0, 0, 0)`);
  ctx.fillStyle = innerGrad;
  ctx.fillRect(0, 0, 128, 128);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  textureCache.set(color, texture);
  return texture;
}

// 天の川パーティクル用テクスチャ
export function createMilkyWayTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0.0, 'rgba(220, 230, 255, 0.8)');
  grad.addColorStop(0.4, 'rgba(180, 200, 255, 0.3)');
  grad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(canvas);
}
