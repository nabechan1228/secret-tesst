import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import {
  StarData,
  ConstellationLineData,
  ConstellationMeta,
  PlanetRecommendation,
  PlanetData,
  DSOData,
  ObsMode
} from './types';

import {
  API_BASE,
  PLANETS_DSO_UPDATE_INTERVAL_MS,
  PLANETS_DSO_TIMELAPSE_UPDATE_INTERVAL_MS,
  DOME_RADIUS,
  LAYER_MILKYWAY,
  INTRO_DURATION,
  DSO_FIXED_COORDS,
  ASTERISM_GUIDES
} from './constants';

import {
  getJulianDate,
  getLocalSiderealTime,
  equatorialToHorizontal,
  horizonToCartesian,
  getScreenPosition
} from './calculations';

import {
  createStarTexture,
  createMilkyWayTexture
} from './textures';

import {
  showToast,
  formatDate,
  setObsModeDescription,
  populateConstellationSelect,
  updatePlanetTrackerUI,
  showConstellationInfo,
  hideConstellationInfo
} from './ui-helper';

// ==========================================
// グローバル状態
// ==========================================

let activeTrackPlanet: string | null = null;
let isPlanetLockOn = false;
let planetRecommendation: PlanetRecommendation | null = null;

let latitude = 35.68;
let longitude = 139.76;

let currentDate = new Date();
let isTimeFlowing = true;
let timeSpeed = 1;

let viewAzimuth = 180;
let viewAltitude = 45;
let baseFov = 85; // 超広角（人間の視野に近い85°）
let observationMode: ObsMode = 'none';
const dsoPhotoObjects: Map<string, THREE.Sprite> = new Map();

let showConstellations = true;
let showStarNames = true;
let showPlanets = true;
let showDSO = true;

let isDragging = false;
let startMouseX = 0;
let startMouseY = 0;
let startAzimuth = 180;
let startAltitude = 45;

let webglCanvas: HTMLCanvasElement;
let overlayCanvas: HTMLCanvasElement;
let ctx2d: CanvasRenderingContext2D;

let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGLRenderer;
let composer: EffectComposer;
let bloomPass: UnrealBloomPass;

const starObjects: Map<number, THREE.Sprite> = new Map();
let constellationMesh: THREE.LineSegments;
let milkyWayParticles: THREE.Points;
let mountainMesh: THREE.Group;      // 山並みシルエット
let atmosphereRing: THREE.Mesh;
let celestialSphereGroup: THREE.Group; // 天球回転グループ

let starsData: StarData[] = [];
let constellationLinesData: ConstellationLineData[] = [];
let constellationMeta: Record<string, ConstellationMeta> = {};
let planetsData: PlanetData[] = [];
let dsoData: DSOData[] = [];

let planetsDsoLastUpdate = 0;

// タイムラプス状態変数
let isTimelapseActive = false;
let timelapseStartTime = 0;
let timelapseDuration = 0; // ms
let timelapseStartSimTime = new Date();
let timelapseEndSimTime = new Date();

let constellationPositions = new Float32Array(10002); // 初期サイズを十分に大きく（10002要素 = 1667セグメント、3の倍数）確保
let starWorker: Worker | null = null;
let isWorkerComputing = false;

let activeGuideId: string | null = null;
let guideTarget: { az: number; alt: number } | null = null;
let isAutoRotatingToGuide = false;

// ==========================================
// レンダリング用ヘルパー
// ==========================================

/** 等級から指数関数的サイズを計算（光の強さを体感に近い形で表現） */
function starVisualScale(mag: number): number {
  const flux = Math.pow(10, -0.4 * mag); // 相対フラックス
  const baseSize = Math.pow(flux, 0.45) * 42.0; // 非線形マッピング
  return Math.max(0.5, Math.min(28.0, baseSize));
}

// ==========================================
// イントロアニメ状態
// ==========================================
let introActive = true;
let introProgress = 0; // 0.0 → 1.0
let introStartTime = 0;

// ==========================================
// 天の川パーティクルシステム
// ==========================================

function buildMilkyWay() {
  if (milkyWayParticles) {
    scene.remove(milkyWayParticles);
    (milkyWayParticles.geometry as THREE.BufferGeometry).dispose();
  }

  const COUNT = 8000;
  const positions = new Float32Array(COUNT * 3);
  const colors = new Float32Array(COUNT * 3);

  for (let i = 0; i < COUNT; i++) {
    const galLon = Math.random() * Math.PI * 2;
    const galLat = (Math.random() - 0.5) * 0.5; // ±14°程度

    const sinB = Math.sin(galLat);
    const cosB = Math.cos(galLat);

    const ngpRa  = 192.8595 * Math.PI / 180;
    const ngpDec = 27.1284  * Math.PI / 180;
    const node   = 122.9319 * Math.PI / 180;

    const sinDec = sinB * Math.sin(ngpDec) +
                   cosB * Math.cos(ngpDec) * Math.sin(galLon - (Math.PI / 2 - node));
    const dec = Math.asin(Math.max(-1, Math.min(1, sinDec)));

    const cosDecVal = Math.cos(dec);
    const safeCosDec = Math.abs(cosDecVal) < 1e-6 ? (cosDecVal < 0 ? -1e-6 : 1e-6) : cosDecVal;

    const cosRaMinusNgpRa = (cosB * Math.cos(galLon - (Math.PI / 2 - node))) / safeCosDec;
    const sinRaMinusNgpRa = (cosB * Math.sin(ngpDec) * Math.sin(galLon - (Math.PI / 2 - node)) -
                             sinB * Math.cos(ngpDec)) / safeCosDec;
    const ra = (Math.atan2(sinRaMinusNgpRa, cosRaMinusNgpRa) + ngpRa + Math.PI * 2) % (Math.PI * 2);

    const r = LAYER_MILKYWAY - 8 + Math.random() * 16;
    positions[i * 3 + 0] = r * Math.cos(dec) * Math.cos(ra);
    positions[i * 3 + 1] = r * Math.sin(dec);
    positions[i * 3 + 2] = -r * Math.cos(dec) * Math.sin(ra);

    const t = Math.random();
    colors[i * 3 + 0] = 0.7 + t * 0.3;
    colors[i * 3 + 1] = 0.75 + t * 0.25;
    colors[i * 3 + 2] = 0.85 + (1 - t) * 0.15;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.PointsMaterial({
    size: 3.5,
    map: createMilkyWayTexture(),
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: 0.85,
    sizeAttenuation: false,
  });

  milkyWayParticles = new THREE.Points(geo, mat);
  milkyWayParticles.frustumCulled = false;
  scene.add(milkyWayParticles);
}

// ==========================================
// 山並みシルエット生成
// ==========================================

function buildMountainSilhouette(): THREE.Group {
  const group = new THREE.Group();

  const SEGMENTS  = 360;
  const BASE_R    = 220;
  const MAX_H     = 50;
  const DEPTH     = 60;

  const heights: number[] = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const t = (i / SEGMENTS) * Math.PI * 2;
    const h =
      Math.sin(t * 3.0 + 0.5)  * 0.35 * MAX_H +
      Math.sin(t * 7.0 + 1.2)  * 0.25 * MAX_H +
      Math.sin(t * 13.0 + 2.8) * 0.15 * MAX_H +
      Math.sin(t * 23.0 + 0.9) * 0.08 * MAX_H +
      Math.sin(t * 41.0 + 3.5) * 0.04 * MAX_H +
      MAX_H * 0.25;
    heights.push(Math.max(8, h));
  }

  const positions: number[] = [];
  const indices:   number[] = [];

  for (let i = 0; i < SEGMENTS; i++) {
    const t0 = (i / SEGMENTS) * Math.PI * 2;
    const t1 = ((i + 1) / SEGMENTS) * Math.PI * 2;
    const h0 = heights[i];
    const h1 = heights[i + 1];

    const x0b = BASE_R * Math.sin(t0);
    const z0b = -BASE_R * Math.cos(t0);
    const x1b = BASE_R * Math.sin(t1);
    const z1b = -BASE_R * Math.cos(t1);

    const base = positions.length / 3;

    positions.push(x0b, -DEPTH, z0b);
    positions.push(x1b, -DEPTH, z1b);
    positions.push(x0b, h0, z0b);
    positions.push(x1b, h1, z1b);

    indices.push(base + 0, base + 1, base + 2);
    indices.push(base + 1, base + 3, base + 2);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  geo.computeBoundingBox();

  const mat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    side: THREE.DoubleSide,
    depthWrite: true,
    depthTest: true,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  group.add(mesh);

  const edgesGeo = new THREE.EdgesGeometry(geo, 20);
  const edgesMat = new THREE.LineBasicMaterial({
    color: 0x0f2d6b,
    transparent: true,
    opacity: 0.65,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const lines = new THREE.LineSegments(edgesGeo, edgesMat);
  lines.frustumCulled = false;
  group.add(lines);

  const ridgePositions: number[] = [];
  for (let i = 0; i < SEGMENTS; i++) {
    const t0 = (i / SEGMENTS) * Math.PI * 2;
    const t1 = ((i + 1) / SEGMENTS) * Math.PI * 2;
    const h0 = heights[i];
    const h1 = heights[i + 1];

    const x0 = BASE_R * Math.sin(t0);
    const z0 = -BASE_R * Math.cos(t0);
    const x1 = BASE_R * Math.sin(t1);
    const z1 = -BASE_R * Math.cos(t1);

    ridgePositions.push(x0, h0, z0);
    ridgePositions.push(x1, h1, z1);
  }

  const ridgeGeo = new THREE.BufferGeometry();
  ridgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(ridgePositions, 3));
  ridgeGeo.computeBoundingSphere();
  ridgeGeo.computeBoundingBox();
  const ridgeMat = new THREE.LineBasicMaterial({
    color: 0x00ffcc,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const ridgeLines = new THREE.LineSegments(ridgeGeo, ridgeMat);
  ridgeLines.frustumCulled = false;
  group.add(ridgeLines);

  return group;
}

// ==========================================
// 3Dシーン初期化
// ==========================================

function init3D() {
  webglCanvas = document.getElementById('webglCanvas') as HTMLCanvasElement;
  overlayCanvas = document.getElementById('overlayCanvas') as HTMLCanvasElement;
  ctx2d = overlayCanvas.getContext('2d')!;

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x000510, 0.00035);

  camera = new THREE.PerspectiveCamera(baseFov, 1, 0.1, 3000);
  camera.position.set(0, 0, 0);

  renderer = new THREE.WebGLRenderer({
    canvas: webglCanvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    1.8,
    0.55,
    0.02
  );
  composer.addPass(bloomPass);

  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  const groundGeo = new THREE.CircleGeometry(DOME_RADIUS * 2, 128);
  const groundMat = new THREE.MeshBasicMaterial({
    color: 0x010208,
    side: THREE.DoubleSide,
    depthWrite: true,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = Math.PI / 2;
  ground.position.y = -1.0;
  scene.add(ground);

  mountainMesh = buildMountainSilhouette();
  scene.add(mountainMesh);

  const atmoGeo = new THREE.TorusGeometry(DOME_RADIUS * 1.08, 12, 16, 200);
  const atmoMat = new THREE.MeshBasicMaterial({
    color: 0x0077aa,
    transparent: true,
    opacity: 0.12,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  atmosphereRing = new THREE.Mesh(atmoGeo, atmoMat);
  atmosphereRing.rotation.x = Math.PI / 2;
  atmosphereRing.position.y = 8;
  scene.add(atmosphereRing);

  const innerAtmoGeo = new THREE.TorusGeometry(DOME_RADIUS * 1.05, 5, 8, 200);
  const innerAtmoMat = new THREE.MeshBasicMaterial({
    color: 0x00aacc,
    transparent: true,
    opacity: 0.25,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const innerAtmoRing = new THREE.Mesh(innerAtmoGeo, innerAtmoMat);
  innerAtmoRing.rotation.x = Math.PI / 2;
  innerAtmoRing.position.y = 2;
  scene.add(innerAtmoRing);

  const zenithRingGeo = new THREE.RingGeometry(5, 15, 64);
  const zenithRingMat = new THREE.MeshBasicMaterial({
    color: 0x3355ff,
    transparent: true,
    opacity: 0.08,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const zenithRing = new THREE.Mesh(zenithRingGeo, zenithRingMat);
  zenithRing.position.y = DOME_RADIUS - 5;
  scene.add(zenithRing);

  celestialSphereGroup = new THREE.Group();
  scene.add(celestialSphereGroup);

  const constGeo = new THREE.BufferGeometry();
  constGeo.setAttribute('position', new THREE.BufferAttribute(constellationPositions, 3));
  const constMat = new THREE.LineBasicMaterial({
    color: 0x66aaff,
    transparent: true,
    opacity: 0.55,
    linewidth: 1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    fog: false,
  });
  constellationMesh = new THREE.LineSegments(constGeo, constMat);
  constellationMesh.frustumCulled = false;
  constellationMesh.renderOrder = 1;
  scene.add(constellationMesh);

  buildMilkyWay();
  buildDsoPhotos();
}

// ==========================================
// データロード (APIから)
// ==========================================

async function loadFromAPI(): Promise<void> {
  const statusEl = document.getElementById('loading-status');
  if (statusEl) statusEl.textContent = 'APIからデータ取得中...';

  try {
    const metaRes = await fetch(`${API_BASE}/api/constellations`);
    if (metaRes.ok) {
      const metaData = await metaRes.json();
      constellationMeta = metaData.constellations;
    }

    const skyData = await fetchSkyData();
    if (!skyData) throw new Error('Sky API error');

    applySkyData(skyData);

    if (statusEl) statusEl.textContent = `${starsData.length}星 / 感星${planetsData.length} / DSO${dsoData.length}天体`;
    console.log(`✓ API loaded: ${starsData.length} stars, ${constellationLinesData.length} constellations`);

    allocateConstellationBuffer();
    buildStarSprites();
    syncStarsToWorker();

  } catch (err) {
    console.error('API load failed:', err);
    if (statusEl) statusEl.textContent = 'APIエラー: バックエンドを起動してください';
    showToast('バックエンドAPIに接続できません。', 'error');
  }
}

async function fetchSkyData(): Promise<Record<string, unknown> | null> {
  const timeStr = encodeURIComponent(currentDate.toISOString());
  const skyRes = await fetch(
    `${API_BASE}/api/sky?lat=${latitude}&lng=${longitude}&mag_limit=6.0&time=${timeStr}`
  );
  if (!skyRes.ok) {
    console.warn(`Sky API responded with status: ${skyRes.status}`);
    return null;
  }
  return skyRes.json();
}

function applySkyData(skyData: Record<string, unknown>): void {
  starsData = (skyData.stars as StarData[]) || [];
  constellationLinesData = (skyData.constellation_lines as ConstellationLineData[]) || [];
  planetsData = (skyData.planets as PlanetData[]) || [];
  dsoData = (skyData.deep_sky_objects as DSOData[]) || [];
  planetRecommendation = (skyData.recommendation as PlanetRecommendation) || null;
  planetsDsoLastUpdate = Date.now();
}

function initWorker() {
  starWorker = new Worker(
    new URL('./star-worker.ts', import.meta.url),
    { type: 'module' }
  );
  
  starWorker.onmessage = (e: MessageEvent) => {
    const { type, coords, constellationCoords, validConstellationElements } = e.data;
    if (type === 'result') {
      updateStarSpritesFromBuffer(coords);
      
      if (showConstellations && constellationCoords && constellationMesh) {
        if (validConstellationElements > constellationPositions.length) {
          resizeConstellationBuffer(validConstellationElements);
        }
        constellationPositions.set(constellationCoords.subarray(0, validConstellationElements));
        constellationMesh.geometry.setDrawRange(0, validConstellationElements / 3);
        constellationMesh.geometry.attributes.position.needsUpdate = true;
        constellationMesh.geometry.computeBoundingSphere();
        constellationMesh.visible = validConstellationElements > 0;
      } else if (constellationMesh) {
        constellationMesh.visible = false;
      }

      isWorkerComputing = false;
    }
  };

  starWorker.onerror = (err) => {
    console.error('Star worker error:', err);
    isWorkerComputing = false;
  };
}

function updateStarSpritesFromBuffer(coords: Float32Array) {
  const count = starsData.length;
  const now = Date.now();

  let targetRa = -1;
  let targetDec = -100;
  if (activeTrackPlanet && observationMode !== 'none') {
    const trackP = planetsData.find(p => p.name === activeTrackPlanet);
    if (trackP) {
      targetRa = trackP.ra;
      targetDec = trackP.dec;
    } else {
      const fixedCoord = DSO_FIXED_COORDS[activeTrackPlanet];
      if (fixedCoord) {
        targetRa = fixedCoord.ra;
        targetDec = fixedCoord.dec;
      }
    }
  }

  for (let i = 0; i < count; i++) {
    const star = starsData[i];
    const sprite = starObjects.get(star.id);
    if (sprite) {
      const idx = i * 4;
      const x = coords[idx];
      const y = coords[idx + 1];
      const z = coords[idx + 2];
      let isVisible = coords[idx + 3] === 1.0;
      
      if (isVisible && targetRa !== -1) {
        const dDec = star.dec - targetDec;
        let dRa = (star.ra - targetRa) * 15.0;
        if (dRa > 180.0) dRa -= 360.0;
        if (dRa < -180.0) dRa += 360.0;
        const dist = Math.sqrt(dRa * dRa + dDec * dDec);
        if (dist < 2.2) {
          isVisible = false;
        }
      }

      sprite.position.set(x, y, z);
      sprite.visible = isVisible;
      
      if (isVisible) {
        let size = starVisualScale(star.mag);
        if (star.mag < 3.0) {
          const twinkle = 0.90 + 0.10 * Math.sin(now * 0.003 + star.id * 17.3);
          size *= twinkle;
        }
        sprite.scale.set(size, size, 1);
      }
    }
  }
}

function syncStarsToWorker() {
  if (starWorker && starsData.length > 0) {
    starWorker.postMessage({
      type: 'init',
      stars: starsData.map(s => ({ id: s.id, ra: s.ra, dec: s.dec, mag: s.mag })),
      constellations: constellationLinesData
    });
    const jd = getJulianDate(currentDate);
    const lst = getLocalSiderealTime(jd, longitude);
    isWorkerComputing = true;
    starWorker.postMessage({ type: 'update', lst, latitude });
  }
}

function allocateConstellationBuffer() {
  const totalSegments = constellationLinesData.reduce((acc, c) => acc + c.segments.length, 0);
  const requiredLength = totalSegments * 6;
  if (requiredLength > constellationPositions.length) {
    resizeConstellationBuffer(requiredLength);
  }
}

function resizeConstellationBuffer(newLength: number) {
  const alignedLength = Math.ceil(newLength / 3) * 3;
  console.warn(`Constellation buffer overflow! Resizing from ${constellationPositions.length} to ${alignedLength}`);
  const newBuffer = new Float32Array(alignedLength);
  newBuffer.set(constellationPositions);
  constellationPositions = newBuffer;
  if (constellationMesh && constellationMesh.geometry) {
    constellationMesh.geometry.setAttribute('position', new THREE.BufferAttribute(constellationPositions, 3));
  }
}

function buildStarSprites() {
  starObjects.forEach(sprite => scene.remove(sprite));
  starObjects.clear();

  starsData.forEach((star) => {
    const texture = createStarTexture(star.color);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const sprite = new THREE.Sprite(material);
    const scale = starVisualScale(star.mag);
    sprite.scale.set(scale, scale, 1);

    scene.add(sprite);
    starObjects.set(star.id, sprite);
  });

  console.log(`Built ${starObjects.size} star sprites`);
}

// ==========================================
// 光害グラデーションドーム（2D Overlay）
// ==========================================

function drawLightPollution(w: number, h: number, lst: number) {
  const sun = planetsData.find(p => p.name === 'Sun');
  let sunAlt = -20;
  if (sun) {
    const hor = equatorialToHorizontal(sun.ra, sun.dec, lst, latitude);
    sunAlt = hor.alt;
  }
  let sunFade = 1.0;
  if (sunAlt > -8) {
    sunFade = Math.max(0.0, 1.0 - (sunAlt + 8) / 8.0);
  }
  if (sunFade <= 0.01) return;

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
  const alt20Y = scr20.visible ? scr20.y : baseY - Math.min(gradEstimate(h), baseY - 20);

  const gradHeight = Math.max(80, baseY - alt20Y);

  ctx2d.save();
  ctx2d.globalAlpha = fadeAlpha * sunFade;

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

function gradEstimate(h: number): number {
  if (!camera) return h * 0.25;
  const pixPerDeg = h / camera.fov;
  return pixPerDeg * 20;
}

// ==========================================
// イントロアニメーション
// ==========================================

function updateIntroCamera(): boolean {
  const now = performance.now();
  if (introStartTime === 0) introStartTime = now;

  const elapsed = now - introStartTime;
  introProgress = Math.min(elapsed / INTRO_DURATION, 1.0);

  const t = 1 - Math.pow(1 - introProgress, 3);

  const startAlt = 5;
  const endAlt = 25;
  viewAltitude = startAlt + (endAlt - startAlt) * t;

  if (introProgress >= 1.0) {
    introActive = false;
    return false;
  }
  return true;
}

// ==========================================
// レンダリングループ
// ==========================================

function updatePositionsAndRender() {
  if (!scene || starsData.length === 0) return;

  const w = overlayCanvas.width;
  const h = overlayCanvas.height;

  const jd = getJulianDate(currentDate);
  const lst = getLocalSiderealTime(jd, longitude);

  document.getElementById('stat-jd')!.textContent = jd.toFixed(5);
  const lstHrs = lst / 15.0;
  const lstH = Math.floor(lstHrs);
  const lstM = Math.floor((lstHrs - lstH) * 60);
  const lstS = Math.floor(((lstHrs - lstH) * 60 - lstM) * 60);
  document.getElementById('stat-lst')!.textContent =
    `${String(lstH).padStart(2, '0')}h ${String(lstM).padStart(2, '0')}m ${String(lstS).padStart(2, '0')}s`;
  document.getElementById('stat-view')!.textContent =
    `Az${viewAzimuth.toFixed(0)}° / Alt${viewAltitude.toFixed(0)}°`;
  document.getElementById('stat-zoom')!.textContent =
    `${Math.round((60.0 / camera.fov) * 100)}%`;
  document.getElementById('stat-stars')!.textContent =
    `${starsData.length}`;

  if (introActive) updateIntroCamera();

  const now = Date.now();

  if (starWorker && starsData.length > 0) {
    if (!isWorkerComputing) {
      isWorkerComputing = true;
      starWorker.postMessage({
        type: 'update',
        lst,
        latitude
      });
    }
  }

  if (constellationMesh) {
    constellationMesh.visible = showConstellations && constellationLinesData.length > 0;
  }

  if (milkyWayParticles) {
    const q1 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), lst * Math.PI / 180.0);
    const q2 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (latitude - 90.0) * Math.PI / 180.0);
    milkyWayParticles.quaternion.multiplyQuaternions(q2, q1);
  }

  if (isAutoRotatingToGuide && guideTarget) {
    let diffAz = guideTarget.az - viewAzimuth;
    if (diffAz > 180) diffAz -= 360;
    if (diffAz < -180) diffAz += 360;

    const diffAlt = guideTarget.alt - viewAltitude;

    viewAzimuth = (viewAzimuth + diffAz * 0.05 + 360) % 360;
    viewAltitude = viewAltitude + diffAlt * 0.05;

    if (!isPlanetLockOn && Math.abs(diffAz) < 0.1 && Math.abs(diffAlt) < 0.1) {
      isAutoRotatingToGuide = false;
    }
  } else if (isPlanetLockOn && activeTrackPlanet) {
    let targetAz: number | null = null;
    let targetAlt: number | null = null;

    const trackP = planetsData.find(p => p.name === activeTrackPlanet);
    if (trackP) {
      const hor = equatorialToHorizontal(trackP.ra, trackP.dec, lst, latitude);
      targetAz = hor.az;
      targetAlt = hor.alt;
    } else {
      const trackD = dsoData.find(d => d.id === activeTrackPlanet);
      if (trackD) {
        const hor = equatorialToHorizontal(trackD.ra, trackD.dec, lst, latitude);
        targetAz = hor.az;
        targetAlt = hor.alt;
      } else {
        const fixedCoord = DSO_FIXED_COORDS[activeTrackPlanet];
        if (fixedCoord) {
          const hor = equatorialToHorizontal(fixedCoord.ra, fixedCoord.dec, lst, latitude);
          targetAz = hor.az;
          targetAlt = hor.alt;
        }
      }
    }

    if (targetAz !== null && targetAlt !== null) {
      let diffAz = targetAz - viewAzimuth;
      if (diffAz > 180) diffAz -= 360;
      if (diffAz < -180) diffAz += 360;

      const diffAlt = targetAlt - viewAltitude;

      viewAzimuth = (viewAzimuth + diffAz * 0.08 + 360) % 360;
      viewAltitude = viewAltitude + diffAlt * 0.08;
    }
  }

  const camAzRad = viewAzimuth * Math.PI / 180.0;
  const camAltRad = viewAltitude * Math.PI / 180.0;
  let targetX = Math.cos(camAltRad) * Math.sin(camAzRad);
  let targetY = Math.sin(camAltRad);
  let targetZ = -Math.cos(camAltRad) * Math.cos(camAzRad);
  if (isNaN(targetX) || isNaN(targetY) || isNaN(targetZ)) {
    targetX = 0; targetY = 1; targetZ = -0.1;
  }
  camera.lookAt(new THREE.Vector3(targetX, targetY, targetZ));

  if (atmosphereRing) {
    const atmoMat = atmosphereRing.material as THREE.MeshBasicMaterial;
    atmoMat.opacity = 0.08 + 0.04 * Math.sin(now * 0.0008);
  }

  if (bloomPass) {
    const zoomFactor = baseFov / camera.fov;
    bloomPass.strength = 1.6 + zoomFactor * 0.5;
    bloomPass.threshold = Math.max(0.0, 0.15 * (zoomFactor - 0.5));
  }

  composer.render();

  ctx2d.clearRect(0, 0, w, h);

  drawLightPollution(w, h, lst);

  if (showStarNames) {
    ctx2d.font = "11px 'Outfit', sans-serif";
    ctx2d.textBaseline = "middle";

    starsData.forEach((star) => {
      if (star.mag > 2.2) return;

      const hor = equatorialToHorizontal(star.ra, star.dec, lst, latitude);
      if (hor.alt < 0) return;

      const pos3d = horizonToCartesian(hor.az, hor.alt, DOME_RADIUS);
      const scr = getScreenPosition(pos3d, camera, overlayCanvas);
      if (!scr.visible) return;

      const starName = star.name_ja;
      if (!starName) return;

      const offset = Math.max(8, (6.5 - star.mag) * 3) + 6;
      ctx2d.fillStyle = 'rgba(0,0,0,0.7)';
      ctx2d.fillText(starName, scr.x + offset + 1, scr.y + 1);
      ctx2d.fillStyle = 'rgba(200, 220, 255, 0.85)';
      ctx2d.fillText(starName, scr.x + offset, scr.y);
    });
  }

  const directions = [
    { name: "N", az: 0 }, { name: "E", az: 90 },
    { name: "S", az: 180 }, { name: "W", az: 270 }
  ];
  ctx2d.font = "bold 13px 'Outfit', sans-serif";
  ctx2d.textAlign = "center";
  directions.forEach((dir) => {
    const pos3d = horizonToCartesian(dir.az, 0, DOME_RADIUS);
    const scr = getScreenPosition(pos3d, camera, overlayCanvas);
    if (scr.visible) {
      ctx2d.fillStyle = 'rgba(0,0,0,0.8)';
      ctx2d.fillText(dir.name, scr.x + 1, scr.y + 1);
      ctx2d.fillStyle = 'rgba(0, 188, 212, 0.85)';
      ctx2d.fillText(dir.name, scr.x, scr.y);
    }
  });

  if (showPlanets && planetsData.length > 0) {
    drawPlanets(lst);
  }

  if (showDSO && dsoData.length > 0) {
    drawDSO(lst);
  }

  if (activeGuideId) {
    drawAsterismGuide(lst);
  }

  updateDsoPhotos(lst);
  drawObservationMask(w, h);
}

// ==========================================
// 惑星描画
// ==========================================

function drawPlanets(lst: number) {
  planetsData.forEach((planet) => {
    const hor = equatorialToHorizontal(planet.ra, planet.dec, lst, latitude);
    if (hor.alt < 0) return;

    if (activeTrackPlanet === planet.name && observationMode !== 'none') {
      return;
    }

    const pos3d = horizonToCartesian(hor.az, hor.alt, DOME_RADIUS);
    const scr = getScreenPosition(pos3d, camera, overlayCanvas);
    if (!scr.visible) return;

    const baseSize = Math.max(6, (1.0 - planet.mag) * 4 + 10);

    const r = parseInt(planet.color.slice(1, 3), 16);
    const g = parseInt(planet.color.slice(3, 5), 16);
    const b = parseInt(planet.color.slice(5, 7), 16);

    const haloRadius = baseSize * 3.5;
    const haloGrad = ctx2d.createRadialGradient(scr.x, scr.y, 0, scr.x, scr.y, haloRadius);
    haloGrad.addColorStop(0.0,  `rgba(255, 255, 255, 0.95)`);
    haloGrad.addColorStop(0.1,  `rgba(${r}, ${g}, ${b}, 0.9)`);
    haloGrad.addColorStop(0.35, `rgba(${r}, ${g}, ${b}, 0.45)`);
    haloGrad.addColorStop(0.70, `rgba(${r}, ${g}, ${b}, 0.12)`);
    haloGrad.addColorStop(1.0,  `rgba(0, 0, 0, 0)`);

    ctx2d.beginPath();
    ctx2d.arc(scr.x, scr.y, haloRadius, 0, Math.PI * 2);
    ctx2d.fillStyle = haloGrad;
    ctx2d.fill();

    const diskGrad = ctx2d.createRadialGradient(scr.x - baseSize * 0.2, scr.y - baseSize * 0.2, 0, scr.x, scr.y, baseSize);
    diskGrad.addColorStop(0, `rgba(255, 255, 255, 1.0)`);
    diskGrad.addColorStop(0.4, `rgba(${r}, ${g}, ${b}, 1.0)`);
    diskGrad.addColorStop(1.0, `rgba(${Math.floor(r*0.6)}, ${Math.floor(g*0.6)}, ${Math.floor(b*0.6)}, 0.8)`);
    ctx2d.beginPath();
    ctx2d.arc(scr.x, scr.y, baseSize, 0, Math.PI * 2);
    ctx2d.fillStyle = diskGrad;
    ctx2d.fill();

    const isRecommended = planetRecommendation && planetRecommendation.name === planet.name;
    const isTracked = activeTrackPlanet === planet.name;

    if (isRecommended || isTracked) {
      const now = Date.now();
      ctx2d.save();

      const pulse1 = 1.0 + 0.12 * Math.sin(now * 0.005);
      const pulse2 = 1.25 - 0.08 * Math.cos(now * 0.005);

      const r1 = baseSize * 2.2 * pulse1;
      const r2 = baseSize * 2.8 * pulse2;

      const glowColor = isTracked ? 'rgba(0, 230, 246, 0.85)' : 'rgba(255, 201, 71, 0.85)';
      const shadowColor = isTracked ? 'rgba(0, 230, 246, 0.4)' : 'rgba(255, 201, 71, 0.4)';

      ctx2d.strokeStyle = glowColor;
      ctx2d.lineWidth = 1.2;
      ctx2d.shadowColor = shadowColor;
      ctx2d.shadowBlur = 6;
      ctx2d.setLineDash([4, 4]);
      ctx2d.beginPath();
      ctx2d.arc(scr.x, scr.y, r2, 0, Math.PI * 2);
      ctx2d.stroke();
      ctx2d.setLineDash([]);

      ctx2d.lineWidth = 1.8;
      ctx2d.beginPath();
      ctx2d.arc(scr.x, scr.y, r1, 0, Math.PI * 2);
      ctx2d.stroke();

      ctx2d.strokeStyle = isTracked ? 'rgba(0, 230, 246, 0.5)' : 'rgba(255, 201, 71, 0.5)';
      ctx2d.lineWidth = 1.0;
      const crossSize = baseSize * 3.5;
      ctx2d.beginPath();
      ctx2d.moveTo(scr.x, scr.y - r1 - 2);
      ctx2d.lineTo(scr.x, scr.y - crossSize);
      ctx2d.moveTo(scr.x, scr.y + r1 + 2);
      ctx2d.lineTo(scr.x, scr.y + crossSize);
      ctx2d.moveTo(scr.x - r1 - 2, scr.y);
      ctx2d.lineTo(scr.x - crossSize, scr.y);
      ctx2d.moveTo(scr.x + r1 + 2, scr.y);
      ctx2d.lineTo(scr.x + crossSize, scr.y);
      ctx2d.stroke();

      ctx2d.restore();
    }

    const labelOffset = baseSize * 3 + 8;
    ctx2d.textAlign = 'left';
    ctx2d.textBaseline = 'middle';
    ctx2d.font = `bold 12px 'Outfit', sans-serif`;

    let labelText = planet.name_ja;
    if (isRecommended) {
      labelText = `🪐 ${planet.name_ja} (${planet.mag}等) [見頃]`;
    } else if (isTracked) {
      labelText = `🎯 ${planet.name_ja} (${planet.mag}等) [追尾中]`;
    }

    ctx2d.fillStyle = 'rgba(0,0,0,0.75)';
    ctx2d.fillText(labelText, scr.x + labelOffset + 1, scr.y + 1);

    if (isRecommended) {
      ctx2d.fillStyle = '#ffc947';
    } else if (isTracked) {
      ctx2d.fillStyle = '#00e6f6';
    } else {
      ctx2d.fillStyle = `rgba(${r + 60 > 255 ? 255 : r + 60}, ${g + 40 > 255 ? 255 : g + 40}, ${b + 20 > 255 ? 255 : b + 20}, 0.95)`;
    }
    ctx2d.fillText(labelText, scr.x + labelOffset, scr.y);
  });
}

// ==========================================
// DSO（深宇宙天体）描画
// ==========================================

function drawDSO(lst: number) {
  dsoData.forEach((obj) => {
    const hor = equatorialToHorizontal(obj.ra, obj.dec, lst, latitude);
    obj.az = hor.az;
    obj.alt = hor.alt;

    if (obj.alt < -15.0) return;

    if (activeTrackPlanet === obj.id && observationMode !== 'none') {
      return;
    }

    const pos3d = horizonToCartesian(obj.az, obj.alt, DOME_RADIUS);
    const scr = getScreenPosition(pos3d, camera, overlayCanvas);
    if (!scr.visible) return;

    const fovDeg = camera.fov;
    const pixPerDeg = overlayCanvas.height / fovDeg;
    const pixPerArcmin = pixPerDeg / 60.0;
    const screenRadius = Math.max(5, (obj.size / 2) * pixPerArcmin);

    ctx2d.save();
    ctx2d.textAlign = 'left';
    ctx2d.textBaseline = 'middle';

    if (obj.type === 'galaxy') {
      const rx = screenRadius;
      const ry = screenRadius * 0.45;
      const angle = Math.PI / 5;

      const grd = ctx2d.createRadialGradient(scr.x, scr.y, 0, scr.x, scr.y, rx);
      grd.addColorStop(0,   'rgba(255, 240, 200, 0.25)');
      grd.addColorStop(0.5, 'rgba(255, 220, 150, 0.12)');
      grd.addColorStop(1,   'rgba(200, 160, 80, 0)');

      ctx2d.translate(scr.x, scr.y);
      ctx2d.rotate(angle);
      ctx2d.scale(1, ry / rx);
      ctx2d.beginPath();
      ctx2d.arc(0, 0, rx, 0, Math.PI * 2);
      ctx2d.fillStyle = grd;
      ctx2d.fill();

      ctx2d.setLineDash([3, 4]);
      ctx2d.strokeStyle = 'rgba(255, 220, 130, 0.6)';
      ctx2d.lineWidth = 1;
      ctx2d.stroke();
      ctx2d.setLineDash([]);
      ctx2d.restore();

      ctx2d.textAlign = 'left';
      ctx2d.textBaseline = 'middle';
      ctx2d.font = `10px 'Outfit', sans-serif`;
      ctx2d.fillStyle = 'rgba(255, 220, 130, 0.85)';
      ctx2d.fillText(`${obj.id} ${obj.name_ja}`, scr.x + screenRadius + 4, scr.y);

    } else if (obj.type === 'nebula' || obj.type === 'supernova_remnant') {
      const grd = ctx2d.createRadialGradient(scr.x, scr.y, 0, scr.x, scr.y, screenRadius);
      grd.addColorStop(0,   'rgba(100, 200, 255, 0.2)');
      grd.addColorStop(0.6, 'rgba(80, 160, 255, 0.08)');
      grd.addColorStop(1,   'rgba(60, 120, 220, 0)');

      ctx2d.beginPath();
      ctx2d.arc(scr.x, scr.y, screenRadius, 0, Math.PI * 2);
      ctx2d.fillStyle = grd;
      ctx2d.fill();

      ctx2d.setLineDash([3, 3]);
      ctx2d.strokeStyle = 'rgba(100, 200, 255, 0.7)';
      ctx2d.lineWidth = 1.2;
      ctx2d.beginPath();
      ctx2d.arc(scr.x, scr.y, screenRadius, 0, Math.PI * 2);
      ctx2d.stroke();
      ctx2d.setLineDash([]);
      ctx2d.restore();

      ctx2d.textAlign = 'left';
      ctx2d.textBaseline = 'middle';
      ctx2d.font = `10px 'Outfit', sans-serif`;
      ctx2d.fillStyle = 'rgba(120, 210, 255, 0.85)';
      ctx2d.fillText(`${obj.id} ${obj.name_ja}`, scr.x + screenRadius + 4, scr.y);

    } else {
      ctx2d.beginPath();
      ctx2d.arc(scr.x, scr.y, screenRadius, 0, Math.PI * 2);
      ctx2d.fillStyle = 'rgba(180, 255, 180, 0.06)';
      ctx2d.fill();

      ctx2d.setLineDash([2, 5]);
      ctx2d.strokeStyle = 'rgba(160, 255, 160, 0.65)';
      ctx2d.lineWidth = 1;
      ctx2d.beginPath();
      ctx2d.arc(scr.x, scr.y, screenRadius, 0, Math.PI * 2);
      ctx2d.stroke();
      ctx2d.setLineDash([]);
      ctx2d.restore();

      ctx2d.textAlign = 'left';
      ctx2d.textBaseline = 'middle';
      ctx2d.font = `10px 'Outfit', sans-serif`;
      ctx2d.fillStyle = 'rgba(160, 255, 160, 0.85)';
      ctx2d.fillText(`${obj.id} ${obj.name_ja}`, scr.x + screenRadius + 4, scr.y);
    }
  });
}

// ==========================================
// 星座・星群ガイド描画
// ==========================================
function drawAsterismGuide(lst: number) {
  const guide = ASTERISM_GUIDES[activeGuideId!];
  if (!guide) return;

  const now = Date.now();
  const starPositions: { x: number; y: number; visible: boolean; name: string; alt: number }[] = [];

  guide.starIds.forEach((sid) => {
    const star = starsData.find(s => s.id === sid);
    if (!star) {
      starPositions.push({ x: 0, y: 0, visible: false, name: `HIP ${sid}`, alt: -90 });
      return;
    }

    const hor = equatorialToHorizontal(star.ra, star.dec, lst, latitude);
    const pos3d = horizonToCartesian(hor.az, hor.alt, DOME_RADIUS);
    const scr = getScreenPosition(pos3d, camera, overlayCanvas);
    
    starPositions.push({
      x: scr.x,
      y: scr.y,
      visible: scr.visible && hor.alt >= 0,
      name: star.name_ja || `HIP ${sid}`,
      alt: hor.alt
    });
  });

  ctx2d.save();

  ctx2d.strokeStyle = 'rgba(255, 201, 71, 0.72)';
  ctx2d.lineWidth = 2.0;
  ctx2d.setLineDash([6, 5]);
  
  guide.linePairs.forEach(([idx1, idx2]) => {
    const p1 = starPositions[idx1];
    const p2 = starPositions[idx2];
    
    if (p1 && p2 && p1.visible && p2.visible) {
      ctx2d.beginPath();
      ctx2d.moveTo(p1.x, p1.y);
      ctx2d.lineTo(p2.x, p2.y);
      ctx2d.stroke();
    }
  });
  ctx2d.setLineDash([]);

  starPositions.forEach((pos) => {
    if (!pos.visible) return;

    const pulse = 1.0 + 0.12 * Math.sin(now * 0.005 + pos.x);
    const baseRadius = 14;
    const r1 = baseRadius * pulse;
    const r2 = (baseRadius + 5) * (1.1 - 0.08 * Math.sin(now * 0.005 + pos.x));

    ctx2d.strokeStyle = 'rgba(255, 201, 71, 0.28)';
    ctx2d.lineWidth = 1.0;
    ctx2d.beginPath();
    ctx2d.arc(pos.x, pos.y, r2, 0, Math.PI * 2);
    ctx2d.stroke();

    ctx2d.strokeStyle = 'rgba(255, 201, 71, 0.85)';
    ctx2d.lineWidth = 1.5;
    ctx2d.shadowColor = 'rgba(255, 201, 71, 0.5)';
    ctx2d.shadowBlur = 8;
    ctx2d.beginPath();
    ctx2d.arc(pos.x, pos.y, r1, 0, Math.PI * 2);
    ctx2d.stroke();
    ctx2d.shadowBlur = 0;

    ctx2d.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx2d.beginPath();
    ctx2d.arc(pos.x, pos.y, 2.5, 0, Math.PI * 2);
    ctx2d.fill();

    ctx2d.font = "bold 12px 'Outfit', 'Noto Sans JP', sans-serif";
    ctx2d.textAlign = 'center';
    ctx2d.textBaseline = 'top';

    const textY = pos.y + baseRadius + 8;
    ctx2d.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx2d.fillText(pos.name, pos.x + 1, textY + 1);
    ctx2d.fillStyle = '#ffc947';
    ctx2d.fillText(pos.name, pos.x, textY);
  });

  const belowHorizonStars = starPositions.filter(p => !p.visible || p.alt < 0);
  if (belowHorizonStars.length > 0) {
    ctx2d.font = "10px 'Outfit', 'Noto Sans JP', sans-serif";
    ctx2d.textAlign = 'right';
    ctx2d.textBaseline = 'bottom';
    ctx2d.fillStyle = 'rgba(255, 201, 71, 0.55)';
    const names = belowHorizonStars.map(p => p.name).join(', ');
    ctx2d.fillText(`※ 現在、地平線下の星: ${names}`, overlayCanvas.width - 16, overlayCanvas.height - 16);
  }

  ctx2d.restore();
}

function drawObservationMask(w: number, h: number) {
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

function buildDsoPhotos() {
  const loader = new THREE.TextureLoader();
  const dsoConfigs = [
    { id: 'M31', file: 'm31.png', ra: 0.7122, dec: 41.2692, scale: 30.0 },
    { id: 'M42', file: 'm42.png', ra: 5.5883, dec: -5.39, scale: 16.0 },
    { id: 'M45', file: 'm45.png', ra: 3.7883, dec: 24.1167, scale: 26.0 },
    { id: 'Moon', file: 'moon.png', ra: 0, dec: 0, scale: 8.7 },
    { id: 'Jupiter', file: 'jupiter.png', ra: 0, dec: 0, scale: 5.0 },
    { id: 'Saturn', file: 'saturn.png', ra: 0, dec: 0, scale: 5.0 },
    { id: 'Venus', file: 'venus.png', ra: 0, dec: 0, scale: 3.5 },
    { id: 'Mars', file: 'mars.png', ra: 0, dec: 0, scale: 3.5 },
    { id: 'M6', file: 'm6.png', ra: 17.668, dec: -32.217, scale: 15.0 },
    { id: 'M7', file: 'm7.png', ra: 17.899, dec: -34.817, scale: 25.0 },
    { id: 'M11', file: 'm11.png', ra: 18.852, dec: -6.267, scale: 12.0 },
    { id: 'M15', file: 'm15.png', ra: 21.500, dec: 12.167, scale: 10.0 },
    { id: 'M24', file: 'm24.png', ra: 18.281, dec: -18.417, scale: 25.0 },
    { id: 'M35', file: 'm35.png', ra: 6.148, dec: 24.333, scale: 16.0 },
    { id: 'M78', file: 'm78.png', ra: 5.778, dec: 0.083, scale: 12.0 },
    { id: 'M83', file: 'm83.png', ra: 13.618, dec: -29.867, scale: 15.0 },
    { id: 'M90', file: 'm90.png', ra: 12.614, dec: 13.167, scale: 12.0 },
    { id: 'IC434', file: 'ic434.png', ra: 5.685, dec: -2.460, scale: 18.0 },
    { id: 'NGC2237', file: 'ngc2237.png', ra: 6.538, dec: 5.017, scale: 24.0 },
    { id: 'NGC869', file: 'ngc869.png', ra: 2.333, dec: 57.143, scale: 20.0 },
    { id: 'NGC7000', file: 'ngc7000.png', ra: 20.983, dec: 44.333, scale: 26.0 },
    { id: 'NGC6960', file: 'ngc6960.png', ra: 20.762, dec: 30.714, scale: 20.0 },
    { id: 'NGC7293', file: 'ngc7293.png', ra: 22.493, dec: -20.835, scale: 16.0 },
    { id: 'NGC6543', file: 'ngc6543.png', ra: 17.977, dec: 66.633, scale: 8.0 }
  ];

  dsoConfigs.forEach(cfg => {
    loader.load(`/assets/${cfg.file}`, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        blending: THREE.NormalBlending,
        depthWrite: false,
        opacity: 0.0
      });
      const sprite = new THREE.Sprite(material);
      sprite.scale.set(cfg.scale, cfg.scale, 1);
      sprite.visible = false;
      scene.add(sprite);
      dsoPhotoObjects.set(cfg.id, sprite);
      console.log(`✓ Loaded astrophotography: ${cfg.id}`);
    }, undefined, (err) => {
      console.error(`Failed to load astrophotography asset: ${cfg.file}`, err);
    });
  });
}

function updateDsoPhotos(lst: number) {
  const fov = camera.fov;
  let maxOpacity = 0.0;
  if (observationMode === 'binoculars') {
    maxOpacity = Math.max(0.0, Math.min(0.5, (15.0 - fov) / 10.0));
  } else if (observationMode === 'telescope') {
    maxOpacity = Math.max(0.0, Math.min(1.0, (15.0 - fov) / 10.0));
  }

  const moonSprite = dsoPhotoObjects.get('Moon');
  if (moonSprite) {
    const isTarget = activeTrackPlanet === 'Moon';
    const moonData = planetsData.find(p => p.name === 'Moon');
    if (moonData && moonData.alt >= -5.0 && isTarget) {
      const hor = equatorialToHorizontal(moonData.ra, moonData.dec, lst, latitude);
      const pos3d = horizonToCartesian(hor.az, hor.alt, DOME_RADIUS - 10);
      moonSprite.position.copy(pos3d);
      moonSprite.visible = hor.alt >= 0 && maxOpacity > 0.05;
      (moonSprite.material as THREE.SpriteMaterial).opacity = maxOpacity;
    } else {
      moonSprite.visible = false;
    }
  }

  const planetsToUpdate = ['Jupiter', 'Saturn', 'Venus', 'Mars'];
  planetsToUpdate.forEach(pid => {
    const sprite = dsoPhotoObjects.get(pid);
    if (sprite) {
      const isTarget = activeTrackPlanet === pid;
      const pData = planetsData.find(p => p.name === pid);
      if (pData && pData.alt >= -5.0 && isTarget) {
        const hor = equatorialToHorizontal(pData.ra, pData.dec, lst, latitude);
        const pos3d = horizonToCartesian(hor.az, hor.alt, DOME_RADIUS - 10);
        sprite.position.copy(pos3d);
        sprite.visible = hor.alt >= 0 && maxOpacity > 0.05;
        (sprite.material as THREE.SpriteMaterial).opacity = maxOpacity;
      } else {
        sprite.visible = false;
      }
    }
  });

  const dsoConfigs = [
    { id: 'M31', ...DSO_FIXED_COORDS['M31'] },
    { id: 'M42', ...DSO_FIXED_COORDS['M42'] },
    { id: 'M45', ...DSO_FIXED_COORDS['M45'] },
    { id: 'M6', ...DSO_FIXED_COORDS['M6'] },
    { id: 'M7', ...DSO_FIXED_COORDS['M7'] },
    { id: 'M11', ...DSO_FIXED_COORDS['M11'] },
    { id: 'M15', ...DSO_FIXED_COORDS['M15'] },
    { id: 'M24', ...DSO_FIXED_COORDS['M24'] },
    { id: 'M35', ...DSO_FIXED_COORDS['M35'] },
    { id: 'M78', ...DSO_FIXED_COORDS['M78'] },
    { id: 'M83', ...DSO_FIXED_COORDS['M83'] },
    { id: 'M90', ...DSO_FIXED_COORDS['M90'] },
    { id: 'IC434', ...DSO_FIXED_COORDS['IC434'] },
    { id: 'NGC2237', ...DSO_FIXED_COORDS['NGC2237'] },
    { id: 'NGC869', ...DSO_FIXED_COORDS['NGC869'] },
    { id: 'NGC7000', ...DSO_FIXED_COORDS['NGC7000'] },
    { id: 'NGC6960', ...DSO_FIXED_COORDS['NGC6960'] },
    { id: 'NGC7293', ...DSO_FIXED_COORDS['NGC7293'] },
    { id: 'NGC6543', ...DSO_FIXED_COORDS['NGC6543'] },
  ];

  dsoConfigs.forEach(cfg => {
    const sprite = dsoPhotoObjects.get(cfg.id);
    if (sprite) {
      const isTarget = activeTrackPlanet === cfg.id;
      if (isTarget) {
        const hor = equatorialToHorizontal(cfg.ra, cfg.dec, lst, latitude);
        const pos3d = horizonToCartesian(hor.az, hor.alt, DOME_RADIUS - 15);
        sprite.position.copy(pos3d);
        sprite.visible = hor.alt >= 0 && maxOpacity > 0.05;
        (sprite.material as THREE.SpriteMaterial).opacity = maxOpacity;
      } else {
        sprite.visible = false;
      }
    }
  });
}

// ==========================================
// イベントリスナー
// ==========================================

function initEvents() {
  const presetSelect = document.getElementById('site-preset') as HTMLSelectElement;
  const latInput = document.getElementById('input-lat') as HTMLInputElement;
  const lngInput = document.getElementById('input-lng') as HTMLInputElement;

  presetSelect.addEventListener('change', () => {
    const presets: Record<string, [number, number]> = {
      tokyo: [35.68, 139.76], sydney: [-33.86, 151.20],
      northpole: [90.0, 0.0], equator: [0.0, 0.0],
      london: [51.50, -0.12], newyork: [40.71, -74.01],
      hawaii: [19.89, -155.58],
    };
    const p = presets[presetSelect.value];
    if (p) {
      latitude = p[0]; longitude = p[1];
      latInput.value = String(latitude);
      lngInput.value = String(longitude);
    }
  });

  latInput.addEventListener('input', () => { latitude = parseFloat(latInput.value) || 0; });
  lngInput.addEventListener('input', () => { longitude = parseFloat(lngInput.value) || 0; });

  const timeFlowCheckbox = document.getElementById('toggle-time-flow') as HTMLInputElement;
  const speedSlider = document.getElementById('time-speed') as HTMLInputElement;
  const speedLabel = document.getElementById('speed-label')!;
  const dateInput = document.getElementById('input-date') as HTMLInputElement;

  timeFlowCheckbox.addEventListener('change', () => { isTimeFlowing = timeFlowCheckbox.checked; });
  speedSlider.addEventListener('input', () => {
    timeSpeed = parseInt(speedSlider.value);
    speedLabel.textContent = `${timeSpeed}x`;
  });

  dateInput.value = formatDate(currentDate);

  dateInput.addEventListener('blur', () => {
    const parsed = Date.parse(dateInput.value.replace(' ', 'T'));
    if (!isNaN(parsed)) currentDate = new Date(parsed);
  });

  const obsTargetSelect = document.getElementById('obs-target-select') as HTMLSelectElement;
  const obsModeSelect = document.getElementById('obs-mode-select') as HTMLSelectElement;
  const obsModeDetails = document.getElementById('obs-mode-details')!;
  const obsModeDesc = document.getElementById('obs-mode-desc')!;

  obsTargetSelect.addEventListener('change', () => {
    const target = obsTargetSelect.value;
    if (target === 'none') {
      activeTrackPlanet = null;
      isPlanetLockOn = false;
      const lockCheckbox = document.getElementById('toggle-planet-lock') as HTMLInputElement;
      if (lockCheckbox) lockCheckbox.checked = false;
      showToast('追尾を解除しました', 'info');
      return;
    }

    activeTrackPlanet = target;
    let targetAz: number | null = null;
    let targetAlt: number | null = null;

    const initJd = getJulianDate(currentDate);
    const initLst = getLocalSiderealTime(initJd, longitude);

    const trackP = planetsData.find(p => p.name === target);
    let trackD = dsoData.find(d => d.id === target);
    if (trackP) {
      const hor = equatorialToHorizontal(trackP.ra, trackP.dec, initLst, latitude);
      targetAz = hor.az;
      targetAlt = hor.alt;
    } else {
      if (trackD) {
        const hor = equatorialToHorizontal(trackD.ra, trackD.dec, initLst, latitude);
        targetAz = hor.az;
        targetAlt = hor.alt;
      } else {
        const fixedCoord = DSO_FIXED_COORDS[target];
        if (fixedCoord) {
          const hor = equatorialToHorizontal(fixedCoord.ra, fixedCoord.dec, initLst, latitude);
          targetAz = hor.az;
          targetAlt = hor.alt;
        }
      }
    }

    if (targetAz !== null && targetAlt !== null) {
      guideTarget = { az: targetAz, alt: Math.max(12, targetAlt) };
      isAutoRotatingToGuide = true;

      observationMode = 'telescope';
      if (obsModeSelect) obsModeSelect.value = 'telescope';
      
      camera.fov = 1.0;
      camera.updateProjectionMatrix();
      
      setObsModeDescription(obsModeDesc, 'telescope');
      obsModeDetails.style.display = 'block';

      isPlanetLockOn = true;
      const lockCheckbox = document.getElementById('toggle-planet-lock') as HTMLInputElement;
      if (lockCheckbox) lockCheckbox.checked = true;

      const targetNameJa = trackP ? trackP.name_ja :
                           trackD ? trackD.name_ja :
                           target === 'Moon' ? '月' : target;
      
      showToast(`${targetNameJa} へ自動導入し、自動追尾を開始します`, 'info');
    } else {
      showToast('ターゲットの位置を計算できませんでした。', 'error');
    }
  });

  obsModeSelect.addEventListener('change', () => {
    const val = obsModeSelect.value as ObsMode;
    observationMode = val;

    if (val === 'none') {
      camera.fov = baseFov;
      camera.updateProjectionMatrix();
      obsModeDetails.style.display = 'none';
      
      obsTargetSelect.value = 'none';
      activeTrackPlanet = null;
      isPlanetLockOn = false;
      const lockCheckbox = document.getElementById('toggle-planet-lock') as HTMLInputElement;
      if (lockCheckbox) lockCheckbox.checked = false;

      showToast('通常モード (肉眼・広角) に戻しました', 'info');
    } else if (val === 'binoculars') {
      camera.fov = 7.5;
      camera.updateProjectionMatrix();
      setObsModeDescription(obsModeDesc, 'binoculars');
      obsModeDetails.style.display = 'block';
      showToast('双眼鏡モード (実視野 7.5°) に切り替えました', 'info');
    } else if (val === 'telescope') {
      camera.fov = 1.0;
      camera.updateProjectionMatrix();
      setObsModeDescription(obsModeDesc, 'telescope');
      obsModeDetails.style.display = 'block';
      showToast('望遠鏡モード (実視野 1.0°) に切り替えました', 'info');
    }
  });

  const constellationCheckbox = document.getElementById('toggle-constellations') as HTMLInputElement;
  const starNamesCheckbox = document.getElementById('toggle-star-names') as HTMLInputElement;

  constellationCheckbox.addEventListener('change', () => { showConstellations = constellationCheckbox.checked; });
  starNamesCheckbox.addEventListener('change', () => { showStarNames = starNamesCheckbox.checked; });

  const planetsCheckbox = document.getElementById('toggle-planets') as HTMLInputElement;
  const dsoCheckbox = document.getElementById('toggle-dso') as HTMLInputElement;
  if (planetsCheckbox) planetsCheckbox.addEventListener('change', () => { showPlanets = planetsCheckbox.checked; });
  if (dsoCheckbox) dsoCheckbox.addEventListener('change', () => { showDSO = dsoCheckbox.checked; });

  const constSelect = document.getElementById('constellation-select') as HTMLSelectElement;
  constSelect.addEventListener('change', () => {
    const cid = constSelect.value;
    if (cid) showConstellationInfo(cid, constellationMeta);
    else hideConstellationInfo();
  });

  document.getElementById('close-const-panel')?.addEventListener('click', () => {
    hideConstellationInfo();
    constSelect.value = '';
  });

  const trackBtn = document.getElementById('btn-track-planet');
  trackBtn?.addEventListener('click', () => {
    if (planetRecommendation) {
      activeTrackPlanet = planetRecommendation.name;
      const targetP = planetsData.find(p => p.name === activeTrackPlanet);
      if (targetP) {
        guideTarget = { az: targetP.az, alt: Math.max(15, targetP.alt) };
        isAutoRotatingToGuide = true;
        showToast(`${planetRecommendation.name_ja} に視点を移動します`, 'info');
      }
    }
  });

  const lockCheckbox = document.getElementById('toggle-planet-lock') as HTMLInputElement;
  lockCheckbox?.addEventListener('change', () => {
    isPlanetLockOn = lockCheckbox.checked;
    if (isPlanetLockOn && planetRecommendation) {
      activeTrackPlanet = planetRecommendation.name;
      const targetP = planetsData.find(p => p.name === activeTrackPlanet);
      if (targetP) {
        guideTarget = { az: targetP.az, alt: Math.max(15, targetP.alt) };
        isAutoRotatingToGuide = true;
      }
      showToast(`${planetRecommendation.name_ja} の自動追尾を開始しました`, 'info');
    } else {
      showToast('自動追尾を停止しました', 'info');
      const obsTargetSelect = document.getElementById('obs-target-select') as HTMLSelectElement;
      if (obsTargetSelect) obsTargetSelect.value = 'none';
      activeTrackPlanet = null;
    }
  });

  webglCanvas.addEventListener('mousedown', (e) => {
    isDragging = true;
    isAutoRotatingToGuide = false;
    isPlanetLockOn = false;
    const lockCheckbox = document.getElementById('toggle-planet-lock') as HTMLInputElement;
    if (lockCheckbox) lockCheckbox.checked = false;
    const obsTargetSelect = document.getElementById('obs-target-select') as HTMLSelectElement;
    if (obsTargetSelect) obsTargetSelect.value = 'none';
    activeTrackPlanet = null;
    startMouseX = e.clientX; startMouseY = e.clientY;
    startAzimuth = viewAzimuth; startAltitude = viewAltitude;
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    if (introActive) { introActive = false; }
    const dx = e.clientX - startMouseX;
    const dy = e.clientY - startMouseY;
    const sensitivity = 0.15 * (camera.fov / 60.0);
    viewAzimuth = ((startAzimuth + dx * sensitivity) % 360.0 + 360.0) % 360.0;
    viewAltitude = Math.max(2.0, Math.min(89.9, startAltitude - dy * sensitivity));
  });

  window.addEventListener('mouseup', () => { isDragging = false; });

  let lastTouchX = 0, lastTouchY = 0;
  webglCanvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      isAutoRotatingToGuide = false;
      isPlanetLockOn = false;
      const lockCheckbox = document.getElementById('toggle-planet-lock') as HTMLInputElement;
      if (lockCheckbox) lockCheckbox.checked = false;
      const obsTargetSelect = document.getElementById('obs-target-select') as HTMLSelectElement;
      if (obsTargetSelect) obsTargetSelect.value = 'none';
      activeTrackPlanet = null;
      lastTouchX = e.touches[0].clientX;
      lastTouchY = e.touches[0].clientY;
      startAzimuth = viewAzimuth;
      startAltitude = viewAltitude;
    }
  });
  webglCanvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (e.touches.length === 1) {
      if (introActive) { introActive = false; }
      const dx = e.touches[0].clientX - lastTouchX;
      const dy = e.touches[0].clientY - lastTouchY;
      const sensitivity = 0.2 * (camera.fov / 60.0);
      viewAzimuth = ((viewAzimuth + dx * sensitivity) % 360.0 + 360.0) % 360.0;
      viewAltitude = Math.max(2.0, Math.min(89.9, viewAltitude - dy * sensitivity));
      lastTouchX = e.touches[0].clientX;
      lastTouchY = e.touches[0].clientY;
    }
  }, { passive: false });

  webglCanvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    
    let minFov = 10.0;
    let maxFov = 100.0;
    if (observationMode === 'binoculars') {
      minFov = 4.0;
      maxFov = 15.0;
    } else if (observationMode === 'telescope') {
      minFov = 0.2;
      maxFov = 4.0;
    }

    camera.fov = Math.max(minFov, Math.min(maxFov, camera.fov * (e.deltaY < 0 ? (1/1.08) : 1.08)));
    camera.updateProjectionMatrix();
  }, { passive: false });

  const timelapseToggleBtn = document.getElementById('btn-timelapse-toggle')!;
  timelapseToggleBtn.addEventListener('click', () => {
    if (isTimelapseActive) {
      stopTimelapse();
      showToast('タイムラプスを停止しました', 'info');
    } else {
      startTimelapse();
    }
  });

  const guideSelect = document.getElementById('guide-select') as HTMLSelectElement;
  const guidePanel = document.getElementById('guide-description-panel')!;
  const guideName = document.getElementById('guide-desc-name')!;
  const guideSeason = document.getElementById('guide-desc-season')!;
  const guideText = document.getElementById('guide-desc-text')!;
  const guideStars = document.getElementById('guide-desc-stars')!;

  guideSelect.addEventListener('change', () => {
    const gid = guideSelect.value;
    if (!gid) {
      activeGuideId = null;
      guideTarget = null;
      isAutoRotatingToGuide = false;
      guidePanel.style.display = 'none';
      return;
    }

    const guide = ASTERISM_GUIDES[gid];
    if (guide) {
      activeGuideId = gid;
      guidePanel.style.display = 'block';
      guideName.textContent = guide.name_ja;
      guideSeason.textContent = guide.season;
      guideText.textContent = guide.desc;

      const starNames: string[] = [];
      guide.starIds.forEach((sid) => {
        const star = starsData.find(s => s.id === sid);
        if (star) {
          starNames.push(star.name_ja || `HIP ${sid}`);
        }
      });
      guideStars.textContent = `構成星: ${starNames.join('、')}`;

      let sumRa = 0, sumDec = 0, count = 0;
      guide.starIds.forEach((sid) => {
        const star = starsData.find(s => s.id === sid);
        if (star) {
          sumRa += star.ra;
          sumDec += star.dec;
          count++;
        }
      });

      if (count > 0) {
        const avgRa = sumRa / count;
        const avgDec = sumDec / count;

        const jd = getJulianDate(currentDate);
        const lst = getLocalSiderealTime(jd, longitude);
        const hor = equatorialToHorizontal(avgRa, avgDec, lst, latitude);

        guideTarget = { az: hor.az, alt: Math.max(15, hor.alt) };
        isAutoRotatingToGuide = true;
        showToast(`${guide.name_ja} に視点を移動します`, 'info');
      }
    }
  });

  const resizeViewport = () => {
    const container = document.getElementById('planetarium-viewport')!;
    const w = container.clientWidth;
    const h = container.clientHeight;
    webglCanvas.width = w; webglCanvas.height = h;
    overlayCanvas.width = w; overlayCanvas.height = h;
    renderer.setSize(w, h);
    composer.setSize(w, h);
    bloomPass.resolution.set(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resizeViewport);
  resizeViewport();
  setTimeout(resizeViewport, 100);
}

// ==========================================
// 更新ループ
// ==========================================

function startTimelapse() {
  const preset = (document.getElementById('timelapse-preset') as HTMLSelectElement).value;
  
  timelapseStartSimTime = new Date(currentDate.getTime());
  
  if (preset === 'sunset-to-sunrise') {
    timelapseStartSimTime.setHours(18, 0, 0, 0);
    timelapseEndSimTime = new Date(timelapseStartSimTime.getTime() + 12 * 60 * 60 * 1000);
    timelapseDuration = 30000;
  } else if (preset === '24hours') {
    timelapseEndSimTime = new Date(timelapseStartSimTime.getTime() + 24 * 60 * 60 * 1000);
    timelapseDuration = 30000;
  } else if (preset === '1year') {
    timelapseEndSimTime = new Date(timelapseStartSimTime.getTime() + 365 * 24 * 60 * 60 * 1000);
    timelapseDuration = 60000;
  }

  currentDate = new Date(timelapseStartSimTime.getTime());
  timelapseStartTime = Date.now();
  isTimelapseActive = true;

  const toggleBtn = document.getElementById('btn-timelapse-toggle')!;
  toggleBtn.textContent = 'タイムラプス停止';
  toggleBtn.className = 'btn btn-danger';
  
  document.getElementById('timelapse-progress-container')!.style.display = 'block';
  
  (document.getElementById('toggle-time-flow') as HTMLInputElement).disabled = true;
  (document.getElementById('time-speed') as HTMLInputElement).disabled = true;
  (document.getElementById('input-date') as HTMLInputElement).disabled = true;

  showToast('タイムラプスを開始しました', 'info');
  
  refreshPlanetsAndDSO();
}

function stopTimelapse() {
  isTimelapseActive = false;
  
  const toggleBtn = document.getElementById('btn-timelapse-toggle')!;
  toggleBtn.textContent = 'タイムラプス開始';
  toggleBtn.className = 'btn btn-accent';
  
  document.getElementById('timelapse-progress-container')!.style.display = 'none';

  (document.getElementById('toggle-time-flow') as HTMLInputElement).disabled = false;
  (document.getElementById('time-speed') as HTMLInputElement).disabled = false;
  (document.getElementById('input-date') as HTMLInputElement).disabled = false;
}

function updateTime() {
  if (isTimelapseActive) {
    const elapsed = Date.now() - timelapseStartTime;
    const progress = Math.min(elapsed / timelapseDuration, 1.0);

    const startMs = timelapseStartSimTime.getTime();
    const endMs = timelapseEndSimTime.getTime();
    currentDate = new Date(startMs + (endMs - startMs) * progress);

    const progressBar = document.getElementById('timelapse-progress-bar');
    const progressText = document.getElementById('timelapse-progress-text');
    if (progressBar) progressBar.style.width = `${progress * 100}%`;
    if (progressText) progressText.textContent = `${Math.round(progress * 100)}%`;

    const dateInput = document.getElementById('input-date') as HTMLInputElement;
    if (dateInput && document.activeElement !== dateInput) {
      dateInput.value = formatDate(currentDate);
    }

    if (progress >= 1.0) {
      stopTimelapse();
      showToast('タイムラプスが完了しました', 'info');
    }
  } else if (isTimeFlowing) {
    currentDate = new Date(currentDate.getTime() + 16.7 * timeSpeed);
    const dateInput = document.getElementById('input-date') as HTMLInputElement;
    if (dateInput && document.activeElement !== dateInput) {
      dateInput.value = formatDate(currentDate);
    }
  }
}

let isRefreshingPlanetsAndDso = false;

async function refreshPlanetsAndDSO() {
  if (isRefreshingPlanetsAndDso) return;
  isRefreshingPlanetsAndDso = true;
  planetsDsoLastUpdate = Date.now();
  try {
    const skyData = await fetchSkyData();
    if (!skyData) {
      console.warn('refreshPlanetsAndDSO: Sky API が失敗しました（更新をスキップ）');
      return;
    }
    
    planetsData = (skyData.planets as PlanetData[]) || [];
    dsoData = (skyData.deep_sky_objects as DSOData[]) || [];
    planetRecommendation = (skyData.recommendation as PlanetRecommendation) || null;

    updatePlanetTrackerUI(planetRecommendation);
  } catch (err) {
    console.warn('refreshPlanetsAndDSO: 例外が発生しました:', err);
  } finally {
    isRefreshingPlanetsAndDso = false;
  }
}

function tick() {
  updateTime();

  const interval = isTimelapseActive ? PLANETS_DSO_TIMELAPSE_UPDATE_INTERVAL_MS : PLANETS_DSO_UPDATE_INTERVAL_MS;
  if (Date.now() - planetsDsoLastUpdate > interval) {
    refreshPlanetsAndDSO();
  }

  updatePositionsAndRender();
  requestAnimationFrame(tick);
}

// ==========================================
// 起動
// ==========================================

async function start() {
  viewAltitude = 5;

  initWorker();
  init3D();
  initEvents();
  await loadFromAPI();
  if (Object.keys(constellationMeta).length > 0) {
    populateConstellationSelect(constellationMeta);
  }
  showToast(`Stellaris 起動完了 - ${starsData.length}星 / 88星座 / 感星${planetsData.length}`, 'info');
  introStartTime = performance.now();
  tick();
}

window.addEventListener('DOMContentLoaded', start);
