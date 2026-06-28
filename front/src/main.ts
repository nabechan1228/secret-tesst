import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';

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
const constellationArtObjects: Map<string, THREE.Mesh> = new Map();

let showConstellations = true;
let showStarNames = true;
let showPlanets = true;
let showDSO = true;

export const ART_CONFIGS = [
  { id: 'Ori', file: 'orion_v4.png', ra: 5.5883, dec: -5.39, scale: 800.0, rotationOffset: 0.0, offsetX: 0.0, offsetY: 0.0, flipX: false },
  { id: 'UMa', file: 'ursa_major_v4.png', ra: 10.66, dec: 55.0, scale: 1200.0, rotationOffset: 0.0, offsetX: 0.0, offsetY: 0.0, flipX: false }
];

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

// クリックイベント判定用
let mouseDownX = 0;
let mouseDownY = 0;
let mouseDownTime = 0;
let touchStartX = 0;
let touchStartY = 0;
let touchStartTime = 0;


// ==========================================
// 拡張機能 (Enhanced Features) 状態
// ==========================================
let bortleScale = 4;
let showMeteors = false;
let activeMeteorShower = 'perseids';

interface MeteorShower {
  name: string;
  ra: number; // hours
  dec: number; // degrees
  color: string;
}

const METEOR_SHOWERS: Record<string, MeteorShower> = {
  perseids: { name: 'ペルセウス座流星群', ra: 3.1, dec: 58.0, color: '#e0f7fa' },
  geminids: { name: 'ふたご座流星群', ra: 7.5, dec: 33.0, color: '#fff9c4' },
  quadrantids: { name: 'しぶんぎ座流星群', ra: 15.3, dec: 49.0, color: '#e1bee7' },
  lyrids: { name: 'こと座流星群', ra: 18.2, dec: 34.0, color: '#f1f8e9' }
};

interface ActiveMeteor {
  line: THREE.Line;
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  speed: number;
  length: number;
  life: number;
  decay: number;
}
let activeMeteors: ActiveMeteor[] = [];

// 日食・月食のリアルタイム計算状態
let isSolarEclipse = false;
let eclipseRatio = 0.0;        // 食の深さ (0→1→0): ピーク時に1
let eclipsePhase = 0.0;        // 食の進行位相 (0→1): 開始→終了で線形増加（月の位置計算用）
let isLunarEclipse = false;
let lunarEclipseRatio = 0.0;   // 月食の深さ (0→1→0)
let lunarEclipsePhase = 0.0;   // 月食の進行位相 (0→1)

// 現在選択中の天体イベント
let activeCelestialEventKey: string | null = null;

interface CelestialEvent {
  name: string;
  lat: number;
  lng: number;
  date: string;
  description: string;
  fov?: number;
  target?: string;
  timelapseStart?: string;
  timelapseEnd?: string;
  // 月食・日食の詳細タイムライン（JST文字列）
  eclipseType?: 'lunar' | 'solar';
  eclipseSubType?: 'annular' | 'total';  // 金環食 or 皆既食
  eclipseStart?: string;   // 食の始まり（本影食始）
  eclipsePeak?: string;    // 食の最大
  eclipseEnd?: string;     // 食の終わり（本影食終）
}

const CELESTIAL_EVENTS: Record<string, CelestialEvent> = {
  'eclipse-2012': {
    name: '2012年 金環日食 (東京)',
    lat: 35.68,
    lng: 139.76,
    date: '2012-05-21T07:32:00+09:00',
    description: '東京で観測された非常に美しい金環日食。太陽と月がほぼ完全に重なり、リング状になりました。タイムラプスで食の進行が再生されます。',
    fov: 1.5,
    target: 'Sun',
    timelapseStart: '2012-05-21T06:50:00+09:00',
    timelapseEnd: '2012-05-21T08:15:00+09:00',
    eclipseType: 'solar',
    eclipseSubType: 'annular',
    eclipseStart: '2012-05-21T06:58:00+09:00',
    eclipsePeak: '2012-05-21T07:32:00+09:00',
    eclipseEnd: '2012-05-21T08:08:00+09:00'
  },
  'eclipse-2022': {
    name: '2022年 皆既月食 (東京)',
    lat: 35.68,
    lng: 139.76,
    date: '2022-11-08T19:59:00+09:00',
    description: '日本全国で好条件で観測された皆既月食。月が地球の本影に入り、幻想的な赤銅色（ブラッドムーン）に染まりました。タイムラプスで食の進行が再生されます。',
    fov: 1.5,
    target: 'Moon',
    timelapseStart: '2022-11-08T18:45:00+09:00',
    timelapseEnd: '2022-11-08T21:10:00+09:00',
    eclipseType: 'lunar',
    eclipseStart: '2022-11-08T18:09:00+09:00',   // 本影食始
    eclipsePeak:  '2022-11-08T19:59:00+09:00',   // 食の最大
    eclipseEnd:   '2022-11-08T21:49:00+09:00'    // 本影食終
  },
  'eclipse-2026': {
    name: '2026年 皆既月食 (東京)',
    lat: 35.68,
    lng: 139.76,
    date: '2026-03-03T20:30:00+09:00',
    description: '2026年3月に発生する皆既月食のシミュレーション。月の欠け始めから皆既までの様子を観察できます。タイムラプスで食の進行が再生されます。',
    fov: 1.5,
    target: 'Moon',
    timelapseStart: '2026-03-03T19:15:00+09:00',
    timelapseEnd: '2026-03-03T21:40:00+09:00',
    eclipseType: 'lunar',
    eclipseStart: '2026-03-03T19:31:00+09:00',
    eclipsePeak:  '2026-03-03T20:47:00+09:00',
    eclipseEnd:   '2026-03-03T22:02:00+09:00'
  },
  'conjunction-2020': {
    name: '2020年 木星・土星超大接近',
    lat: 35.68,
    lng: 139.76,
    date: '2020-12-21T17:30:00+09:00',
    description: '約400年ぶりとなる木星と土星の超大接近。望遠鏡の同一視野内に木星のガリレオ衛星と土星の環が同時に収まりました。',
    fov: 0.4,
    target: 'Jupiter'
  }
};



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

  renderer.xr.enabled = true;
  const vrButton = VRButton.createButton(renderer);
  vrButton.style.bottom = '20px';
  vrButton.style.zIndex = '9999';
  document.body.appendChild(vrButton);
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

  const bortleLimits = [6.5, 6.5, 6.0, 5.5, 5.0, 4.5, 4.0, 3.5, 3.0, 2.0];
  const limit = bortleLimits[bortleScale];

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

      // 光害レベル制限によるフィルタリング
      if (isVisible && star.mag > limit) {
        isVisible = false;
      }
      
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

  // 天の川の不透明度も光害レベルに応じて減衰
  if (milkyWayParticles) {
    const mwOpacity = Math.max(0.0, 0.85 * (1.0 - (bortleScale - 1) / 5.0));
    (milkyWayParticles.material as THREE.PointsMaterial).opacity = mwOpacity;
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
  const alt20Y = scr20.visible ? scr20.y : baseY - Math.min(gradEstimate(h), baseY - 20);

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

  // --- 日食・月食の判定 ---
  const sunData = planetsData.find(p => p.name === 'Sun');
  const moonData = planetsData.find(p => p.name === 'Moon');
  
  isSolarEclipse = false;
  eclipseRatio = 0.0;
  eclipsePhase = 0.0;
  isLunarEclipse = false;
  lunarEclipseRatio = 0.0;
  lunarEclipsePhase = 0.0;

  // ★ 月食・日食イベントが選択中の場合、現在時刻と食の進行タイムラインから直接計算
  if (activeCelestialEventKey) {
    const activeEv = CELESTIAL_EVENTS[activeCelestialEventKey];
    if (activeEv && activeEv.eclipseType && activeEv.eclipseStart && activeEv.eclipsePeak && activeEv.eclipseEnd) {
      const tStart = new Date(activeEv.eclipseStart).getTime();
      const tPeak  = new Date(activeEv.eclipsePeak).getTime();
      const tEnd   = new Date(activeEv.eclipseEnd).getTime();
      const tNow   = currentDate.getTime();

      // ratio: 食の深さ（0→1→0）— ピーク時に1
      let ratio = 0.0;
      if (tNow >= tStart && tNow <= tPeak) {
        ratio = (tNow - tStart) / (tPeak - tStart);
      } else if (tNow > tPeak && tNow <= tEnd) {
        ratio = 1.0 - (tNow - tPeak) / (tEnd - tPeak);
      }
      ratio = Math.max(0.0, Math.min(1.0, ratio));

      // phase: 食の進行位相（0→1）— 開始から終了まで線形に増加（影/月の位置計算用）
      let phase = 0.0;
      if (tNow < tStart) {
        phase = 0.0;
      } else if (tNow > tEnd) {
        phase = 1.0;
      } else {
        phase = (tNow - tStart) / (tEnd - tStart);
      }
      phase = Math.max(0.0, Math.min(1.0, phase));

      if (activeEv.eclipseType === 'lunar') {
        isLunarEclipse = ratio > 0.01;
        lunarEclipseRatio = ratio;
        lunarEclipsePhase = phase;
      } else if (activeEv.eclipseType === 'solar') {
        isSolarEclipse = ratio > 0.01;
        eclipseRatio = ratio;
        eclipsePhase = phase;
      }
    }
  } else if (sunData && moonData) {
    // 通常時の日食判定（天体位置から計算）
    const dDec = sunData.dec - moonData.dec;
    let dRa = (sunData.ra - moonData.ra) * 15.0;
    if (dRa > 180.0) dRa -= 360.0;
    if (dRa < -180.0) dRa += 360.0;
    const angularDist = Math.sqrt(dRa * dRa + dDec * dDec);
    if (angularDist < 1.0) {
      isSolarEclipse = true;
      eclipseRatio = Math.max(0.0, 1.0 - angularDist / 1.0);
    }
  }


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
  updateMeteors(lst);
  drawObservationMask(w, h);
}

// ==========================================
// 惑星描画
// ==========================================

function drawPlanets(lst: number) {
  // ★ 月食中は特別処理：月追尾中は画面中央にブラッドムーンを強制描画
  if (isLunarEclipse && activeTrackPlanet === 'Moon' && observationMode !== 'none') {
    const moonPlanet = planetsData.find(p => p.name === 'Moon');
    if (moonPlanet) {
      const ratio = lunarEclipseRatio;
      const phase = lunarEclipsePhase;

      const cx = overlayCanvas.width / 2;
      const cy = overlayCanvas.height / 2;

      const fovDeg = camera.fov;
      const pixPerDeg = overlayCanvas.height / fovDeg;
      const baseSize = 0.25 * pixPerDeg; // 視半径 0.25度

      // --- 月の元の色（通常白〜灰色）---
      const moonR = 255, moonG = 253, moonB = 231;

      // 月のハロー（通常の月光）
      const haloRadius = baseSize * 3.0;
      const haloGrad = ctx2d.createRadialGradient(cx, cy, 0, cx, cy, haloRadius);
      haloGrad.addColorStop(0.0,  `rgba(255, 255, 255, 0.9)`);
      haloGrad.addColorStop(0.15, `rgba(${moonR}, ${moonG}, ${moonB}, 0.8)`);
      haloGrad.addColorStop(0.45, `rgba(${moonR}, ${moonG}, ${moonB}, 0.3)`);
      haloGrad.addColorStop(0.80, `rgba(${moonR}, ${Math.floor(moonG * 0.5)}, 0, 0.08)`);
      haloGrad.addColorStop(1.0,  'rgba(0, 0, 0, 0)');
      ctx2d.beginPath();
      ctx2d.arc(cx, cy, haloRadius, 0, Math.PI * 2);
      ctx2d.fillStyle = haloGrad;
      ctx2d.fill();

      // 月のディスク（通常の明るい月面色）
      const diskGrad = ctx2d.createRadialGradient(
        cx - baseSize * 0.2, cy - baseSize * 0.2, 0,
        cx, cy, baseSize
      );
      diskGrad.addColorStop(0,   `rgba(255, 255, 240, 1.0)`);
      diskGrad.addColorStop(0.4, `rgba(${moonR}, ${moonG}, ${moonB}, 1.0)`);
      diskGrad.addColorStop(1.0, `rgba(200, 195, 180, 0.9)`);
      ctx2d.beginPath();
      ctx2d.arc(cx, cy, baseSize, 0, Math.PI * 2);
      ctx2d.fillStyle = diskGrad;
      ctx2d.fill();

      // --- 地球の影ディスク（月面上を横切る暗い円）---
      // phaseに基づいて影が右→中央→左へ移動
      const shadowDiskRadius = baseSize * 1.6; // 地球の本影は月より大きい
      const maxShadowOffset = baseSize * 2.5;
      // phase=0: 影は右端(+maxOffset), phase=0.5: 中央, phase=1: 左端(-maxOffset)
      const shadowOffsetX = maxShadowOffset * (1.0 - 2.0 * phase);
      const shadowCx = cx + shadowOffsetX;
      const shadowCy = cy;

      ctx2d.save();
      // クリッピング: 月のディスク内のみに影を描画
      ctx2d.beginPath();
      ctx2d.arc(cx, cy, baseSize, 0, Math.PI * 2);
      ctx2d.clip();

      // 地球の影（暗い赤褐色のグラデーション — ブラッドムーン色）
      const shadowGrad = ctx2d.createRadialGradient(
        shadowCx, shadowCy, 0,
        shadowCx, shadowCy, shadowDiskRadius
      );
      shadowGrad.addColorStop(0.0, 'rgba(15, 3, 2, 0.99)');    // 中心部は非常に暗い
      shadowGrad.addColorStop(0.70, 'rgba(40, 10, 5, 0.98)');  // 本影内部（暗）
      shadowGrad.addColorStop(0.85, 'rgba(100, 20, 10, 0.95)'); // 本影の境界付近
      shadowGrad.addColorStop(0.92, 'rgba(160, 36, 24, 0.6)');  // 境界の遷移（赤みがかった半影）
      shadowGrad.addColorStop(0.97, 'rgba(180, 50, 30, 0.15)'); // 半影の外縁
      shadowGrad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
      ctx2d.beginPath();
      ctx2d.arc(shadowCx, shadowCy, shadowDiskRadius, 0, Math.PI * 2);
      ctx2d.fillStyle = shadowGrad;
      ctx2d.fill();
      ctx2d.restore();

      // 皆既時の赤い月面グロー
      if (ratio > 0.7) {
        ctx2d.save();
        const glowRad = baseSize * (2.5 + ratio * 1.5);
        const glowGrad = ctx2d.createRadialGradient(cx, cy, baseSize * 0.8, cx, cy, glowRad);
        glowGrad.addColorStop(0.0, `rgba(160, 12, 0, ${0.35 * ratio})`);
        glowGrad.addColorStop(0.5, `rgba(120, 0, 0, ${0.12 * ratio})`);
        glowGrad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
        ctx2d.beginPath();
        ctx2d.arc(cx, cy, glowRad, 0, Math.PI * 2);
        ctx2d.fillStyle = glowGrad;
        ctx2d.fill();
        ctx2d.restore();
      }

      // 月のラベル
      const labelOffset = baseSize * 3 + 8;
      ctx2d.textAlign = 'left';
      ctx2d.textBaseline = 'middle';
      ctx2d.font = `bold 12px 'Outfit', sans-serif`;
      const eclipseLabel = ratio > 0.95 ? `\u{1F311} 月 [皆既月食・ブラッドムーン]` : `\u{1F312} 月 [月食進行中 ${Math.round(ratio * 100)}%]`;
      ctx2d.fillStyle = 'rgba(0,0,0,0.75)';
      ctx2d.fillText(eclipseLabel, cx + labelOffset + 1, cy + 1);
      ctx2d.fillStyle = `rgba(220, 80, 60, 0.95)`;
      ctx2d.fillText(eclipseLabel, cx + labelOffset, cy);
    }
  }

  // ★ 日食中は特別処理：太陽追尾中は画面中央に日食アニメーションを強制描画
  if (isSolarEclipse && activeTrackPlanet === 'Sun' && observationMode !== 'none') {
    const sunPlanet = planetsData.find(p => p.name === 'Sun');
    if (sunPlanet) {
      const ratio = eclipseRatio;
      const cx = overlayCanvas.width / 2;
      const cy = overlayCanvas.height / 2;
      const fovDeg = camera.fov;
      const pixPerDeg = overlayCanvas.height / fovDeg;
      const sunRadius = 0.25 * pixPerDeg; // 太陽の視半径 0.25度

      // 金環食か皆既食かを判定
      const activeEv = activeCelestialEventKey ? CELESTIAL_EVENTS[activeCelestialEventKey] : null;
      const isAnnular = activeEv?.eclipseSubType === 'annular';

      // 月のディスクサイズ: 金環食では太陽より少し小さい、皆既食では同サイズ〜やや大きい
      const moonRadius = isAnnular ? sunRadius * 0.90 : sunRadius * 1.02;

      // eclipsePhaseに基づいて月の位置をアニメーション
      // phase 0→1: 月が右端から左端へ太陽上を一方向に横切る
      const maxOffset = sunRadius * 2.5; // 月が太陽の外から入ってくる距離
      // phase=0: 右端(+maxOffset), phase=0.5(ピーク付近): 中央(0), phase=1: 左端(-maxOffset)
      const moonOffsetX = maxOffset * (1.0 - 2.0 * eclipsePhase);
      const moonCx = cx + moonOffsetX;
      const moonCy = cy;

      // --- コロナ描画（皆既食で深い食の時、または金環食のリング） ---
      if (ratio > 0.5) {
        ctx2d.save();
        if (isAnnular && ratio > 0.8) {
          // 金環食: 太陽のリング状コロナ（月の周囲に見える太陽光のリング）
          const ringGlowRad = sunRadius * (3.0 + 0.5 * Math.sin(Date.now() * 0.006));
          const ringGrad = ctx2d.createRadialGradient(cx, cy, sunRadius * 0.5, cx, cy, ringGlowRad);
          ringGrad.addColorStop(0.0, `rgba(255, 220, 100, ${0.6 * ratio})`);
          ringGrad.addColorStop(0.3, `rgba(255, 180, 60, ${0.35 * ratio})`);
          ringGrad.addColorStop(0.6, `rgba(255, 120, 30, ${0.15 * ratio})`);
          ringGrad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
          ctx2d.beginPath();
          ctx2d.arc(cx, cy, ringGlowRad, 0, Math.PI * 2);
          ctx2d.fillStyle = ringGrad;
          ctx2d.fill();
        } else if (!isAnnular && ratio > 0.8) {
          // 皆既食: 白いコロナ
          const coronaRad = sunRadius * (4.2 + 0.8 * Math.sin(Date.now() * 0.008));
          const coronaGrad = ctx2d.createRadialGradient(cx, cy, sunRadius * 0.8, cx, cy, coronaRad);
          coronaGrad.addColorStop(0.0, `rgba(255, 255, 255, ${0.95 * ratio})`);
          coronaGrad.addColorStop(0.15, `rgba(235, 245, 255, ${0.7 * ratio})`);
          coronaGrad.addColorStop(0.4, `rgba(180, 210, 240, ${0.3 * ratio})`);
          coronaGrad.addColorStop(0.7, `rgba(100, 140, 200, ${0.1 * ratio})`);
          coronaGrad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
          ctx2d.beginPath();
          ctx2d.arc(cx, cy, coronaRad, 0, Math.PI * 2);
          ctx2d.fillStyle = coronaGrad;
          ctx2d.fill();
        }
        ctx2d.restore();
      }

      // --- 太陽のハロー ---
      const haloRadius = sunRadius * 3.5;
      const haloGrad = ctx2d.createRadialGradient(cx, cy, 0, cx, cy, haloRadius);
      haloGrad.addColorStop(0.0, 'rgba(255, 255, 255, 0.95)');
      haloGrad.addColorStop(0.1, 'rgba(255, 210, 80, 0.9)');
      haloGrad.addColorStop(0.35, 'rgba(255, 180, 50, 0.45)');
      haloGrad.addColorStop(0.70, 'rgba(255, 150, 30, 0.12)');
      haloGrad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
      ctx2d.beginPath();
      ctx2d.arc(cx, cy, haloRadius, 0, Math.PI * 2);
      ctx2d.fillStyle = haloGrad;
      ctx2d.fill();

      // --- 太陽ディスク ---
      const sunDiskGrad = ctx2d.createRadialGradient(
        cx - sunRadius * 0.2, cy - sunRadius * 0.2, 0,
        cx, cy, sunRadius
      );
      sunDiskGrad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
      sunDiskGrad.addColorStop(0.4, 'rgba(255, 210, 80, 1.0)');
      sunDiskGrad.addColorStop(1.0, 'rgba(230, 160, 40, 0.85)');
      ctx2d.beginPath();
      ctx2d.arc(cx, cy, sunRadius, 0, Math.PI * 2);
      ctx2d.fillStyle = sunDiskGrad;
      ctx2d.fill();

      // --- 月影ディスク（太陽の上に重なる黒い円）---
      if (ratio > 0.01) {
        ctx2d.save();

        if (isAnnular) {
          // 金環食: 月は太陽より小さいので、重なっても太陽のリングが見える
          ctx2d.beginPath();
          ctx2d.arc(moonCx, moonCy, moonRadius, 0, Math.PI * 2);

          // 月の暗部にもわずかな赤味を加える（大気屈折）
          const moonDiskGrad = ctx2d.createRadialGradient(moonCx, moonCy, 0, moonCx, moonCy, moonRadius);
          moonDiskGrad.addColorStop(0.0, 'rgba(8, 5, 15, 0.98)');
          moonDiskGrad.addColorStop(0.7, 'rgba(5, 3, 12, 0.99)');
          moonDiskGrad.addColorStop(1.0, 'rgba(2, 2, 8, 1.0)');
          ctx2d.fillStyle = moonDiskGrad;
          ctx2d.fill();

          // 金環食のリング強調: 月の縁を微かに光らせる（太陽光の回折）
          if (ratio > 0.85) {
            const edgeGlow = ctx2d.createRadialGradient(moonCx, moonCy, moonRadius * 0.95, moonCx, moonCy, moonRadius * 1.15);
            edgeGlow.addColorStop(0.0, 'rgba(255, 200, 80, 0.0)');
            edgeGlow.addColorStop(0.4, `rgba(255, 220, 100, ${0.3 * ratio})`);
            edgeGlow.addColorStop(1.0, 'rgba(255, 180, 60, 0.0)');
            ctx2d.beginPath();
            ctx2d.arc(moonCx, moonCy, moonRadius * 1.15, 0, Math.PI * 2);
            ctx2d.fillStyle = edgeGlow;
            ctx2d.fill();
          }
        } else {
          // 皆既食: 月は太陽とほぼ同サイズ
          ctx2d.beginPath();
          ctx2d.arc(moonCx, moonCy, moonRadius, 0, Math.PI * 2);
          ctx2d.fillStyle = '#02030b';
          ctx2d.shadowColor = 'rgba(0, 0, 0, 0.9)';
          ctx2d.shadowBlur = 5;
          ctx2d.fill();

          // ダイヤモンドリング: 食の始まりと終わりの瞬間（ratio 0.85-0.95くらい）
          if (ratio > 0.80 && ratio < 0.96) {
            const diamondAngle = ratio < 0.90 ? Math.PI * 0.15 : Math.PI * 1.85; // 右側 or 左側
            const dx = moonCx + Math.cos(diamondAngle) * moonRadius * 0.95;
            const dy = moonCy + Math.sin(diamondAngle) * moonRadius * 0.95;
            const diamondRad = sunRadius * 0.4;
            const diamondGrad = ctx2d.createRadialGradient(dx, dy, 0, dx, dy, diamondRad);
            diamondGrad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
            diamondGrad.addColorStop(0.2, 'rgba(255, 250, 230, 0.8)');
            diamondGrad.addColorStop(0.5, 'rgba(255, 220, 150, 0.3)');
            diamondGrad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
            ctx2d.beginPath();
            ctx2d.arc(dx, dy, diamondRad, 0, Math.PI * 2);
            ctx2d.fillStyle = diamondGrad;
            ctx2d.fill();
          }
        }
        ctx2d.restore();
      }

      // ラベル
      const labelOffset = sunRadius * 3 + 8;
      ctx2d.textAlign = 'left';
      ctx2d.textBaseline = 'middle';
      ctx2d.font = `bold 12px 'Outfit', sans-serif`;
      let eclipseLabel: string;
      if (isAnnular) {
        eclipseLabel = ratio > 0.95 ? `☀ 太陽 [金環日食・最大]` : `🌘 太陽 [金環日食 ${Math.round(ratio * 100)}%]`;
      } else {
        eclipseLabel = ratio > 0.95 ? `🌑 太陽 [皆既日食・コロナ]` : `🌘 太陽 [日食進行中 ${Math.round(ratio * 100)}%]`;
      }
      ctx2d.fillStyle = 'rgba(0,0,0,0.75)';
      ctx2d.fillText(eclipseLabel, cx + labelOffset + 1, cy + 1);
      ctx2d.fillStyle = isAnnular ? 'rgba(255, 200, 60, 0.95)' : 'rgba(200, 220, 255, 0.95)';
      ctx2d.fillText(eclipseLabel, cx + labelOffset, cy);
    }
  }

  planetsData.forEach((planet) => {
    const hor = equatorialToHorizontal(planet.ra, planet.dec, lst, latitude);
    if (hor.alt < 0) return;

    // 太陽は3D写真アセットがないため、望遠鏡モードで追尾中でもスキップせず2D描画を強制
    // ただし日食の特別描画で太陽を描画済みの場合はスキップ
    // 月は月食中に上の特別処理で描画済みなので、追尾中はスキップ
    if (activeTrackPlanet === planet.name && observationMode !== 'none') {
      if (planet.name === 'Sun' && isSolarEclipse) {
        return; // 日食中の太陽は上の特別描画で描画済み
      }
      if (planet.name !== 'Sun') {
        return; // 月食中の月は上で描画済み
      }
    }

    const pos3d = horizonToCartesian(hor.az, hor.alt, DOME_RADIUS);
    const scr = getScreenPosition(pos3d, camera, overlayCanvas);
    if (!scr.visible) return;

    let baseSize = Math.max(6, (1.0 - planet.mag) * 4 + 10);
    // 双眼鏡・望遠鏡モードの時は、太陽と月を見かけの視直径（約0.5度）に合わせてズーム拡大
    if (observationMode !== 'none' && (planet.name === 'Sun' || planet.name === 'Moon')) {
      const fovDeg = camera.fov;
      const pixPerDeg = overlayCanvas.height / fovDeg;
      baseSize = 0.25 * pixPerDeg; // 視半径 0.25度
    }


    let r = parseInt(planet.color.slice(1, 3), 16);
    let g = parseInt(planet.color.slice(3, 5), 16);
    let b = parseInt(planet.color.slice(5, 7), 16);

    // 月食（ブラッドムーン）発生時は、食の度合いに応じて色調を赤褐色にシフト
    if (planet.name === 'Moon' && isLunarEclipse) {
      const ratio = lunarEclipseRatio;
      r = Math.floor(r * (1.0 - ratio) + 160 * ratio); // 160 = 赤銅色の赤成分
      g = Math.floor(g * (1.0 - ratio) + 36 * ratio);  // 36 = 緑成分
      b = Math.floor(b * (1.0 - ratio) + 24 * ratio);  // 24 = 青成分
    }

    // 太陽のコロナ（日食が極めて深いときのみ、ディスク描画の前に背景に光輪として描く）
    // 望遠鏡モードで太陽追尾中は上の特別描画でカバーされるのでスキップ
    if (planet.name === 'Sun' && isSolarEclipse && eclipseRatio > 0.8 && !(activeTrackPlanet === 'Sun' && observationMode !== 'none')) {
      ctx2d.save();
      const activeEv = activeCelestialEventKey ? CELESTIAL_EVENTS[activeCelestialEventKey] : null;
      const isAnnular = activeEv?.eclipseSubType === 'annular';
      // ゆらぎ効果を入れて有機的に光り輝かせる
      const coronaRad = baseSize * (4.2 + 0.8 * Math.sin(Date.now() * 0.008));
      const coronaGrad = ctx2d.createRadialGradient(scr.x, scr.y, baseSize * 0.8, scr.x, scr.y, coronaRad);
      if (isAnnular) {
        // 金環食: 暖色系のコロナ
        coronaGrad.addColorStop(0.0, `rgba(255, 220, 100, ${0.7 * eclipseRatio})`);
        coronaGrad.addColorStop(0.3, `rgba(255, 180, 60, ${0.4 * eclipseRatio})`);
        coronaGrad.addColorStop(0.6, `rgba(255, 120, 30, ${0.15 * eclipseRatio})`);
        coronaGrad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
      } else {
        coronaGrad.addColorStop(0.0, 'rgba(255, 255, 255, 0.95)');
        coronaGrad.addColorStop(0.2, 'rgba(235, 245, 255, 0.7)');
        coronaGrad.addColorStop(0.5, 'rgba(160, 200, 240, 0.3)');
        coronaGrad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
      }
      
      ctx2d.beginPath();
      ctx2d.arc(scr.x, scr.y, coronaRad, 0, Math.PI * 2);
      ctx2d.fillStyle = coronaGrad;
      ctx2d.fill();
      ctx2d.restore();
    }

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

    // 日食時の月の影ディスクの重ね合わせ（太陽の上に重なる黒い円を描画）
    // 望遠鏡モードで太陽追尾中は上の特別描画でカバーされるのでスキップ
    if (planet.name === 'Sun' && isSolarEclipse && !(activeTrackPlanet === 'Sun' && observationMode !== 'none')) {
      const ratio = eclipseRatio;
      if (ratio > 0.01) {
        // 金環食か皆既食かを判定
        const activeEv = activeCelestialEventKey ? CELESTIAL_EVENTS[activeCelestialEventKey] : null;
        const isAnnular = activeEv?.eclipseSubType === 'annular';
        const moonDiskSize = isAnnular ? baseSize * 0.88 : baseSize * 0.98;

        // eclipsePhaseに基づいて月影の位置を太陽に対して計算（右→中央→左）
        const maxOff = baseSize * 2.2;
        const offsetX = maxOff * (1.0 - 2.0 * eclipsePhase);
        const moonX = scr.x + offsetX;
        const moonY = scr.y;

        ctx2d.save();
        ctx2d.beginPath();
        ctx2d.arc(moonX, moonY, moonDiskSize, 0, Math.PI * 2);
        ctx2d.fillStyle = '#02030b';
        ctx2d.shadowColor = 'rgba(0, 0, 0, 0.9)';
        ctx2d.shadowBlur = 3;
        ctx2d.fill();
        ctx2d.restore();
      }
    }

    // 月食時の地球の影オーバーレイ（通常描画ルートの月にかかる影）
    // 望遠鏡モードで月追尾中は上の特別描画でカバーされるのでスキップ
    if (planet.name === 'Moon' && isLunarEclipse && lunarEclipseRatio > 0.01 && !(activeTrackPlanet === 'Moon' && observationMode !== 'none')) {
      const ratio = lunarEclipseRatio;
      ctx2d.save();

      // 地球の影を半円形のオーバーレイとして描画
      // phaseに基づいて影の中心を右→中央→左へ移動
      const shadowOffsetX = baseSize * 2.0 * (1.0 - 2.0 * lunarEclipsePhase);
      const shadowRadius = baseSize * 1.8; // 地球の影は月より大きい

      // クリッピング: 月のディスク内のみに影を描画
      ctx2d.beginPath();
      ctx2d.arc(scr.x, scr.y, baseSize, 0, Math.PI * 2);
      ctx2d.clip();

      // 地球の影（暗い赤褐色のグラデーション）
      const shadowGrad = ctx2d.createRadialGradient(
        scr.x + shadowOffsetX, scr.y, 0,
        scr.x + shadowOffsetX, scr.y, shadowRadius
      );
      const shadowAlpha = Math.min(0.92, 0.5 + ratio * 0.42);
      shadowGrad.addColorStop(0.0, `rgba(15, 3, 2, ${shadowAlpha * 0.98})`);
      shadowGrad.addColorStop(0.70, `rgba(30, 8, 5, ${shadowAlpha * 0.95})`);
      shadowGrad.addColorStop(0.85, `rgba(60, 15, 10, ${shadowAlpha * 0.90})`);
      shadowGrad.addColorStop(0.92, `rgba(100, 20, 15, ${shadowAlpha * 0.55})`);
      shadowGrad.addColorStop(0.97, `rgba(120, 30, 20, ${shadowAlpha * 0.15})`);
      shadowGrad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
      ctx2d.beginPath();
      ctx2d.arc(scr.x + shadowOffsetX, scr.y, shadowRadius, 0, Math.PI * 2);
      ctx2d.fillStyle = shadowGrad;
      ctx2d.fill();

      ctx2d.restore();
    }

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

// ==========================================
// 流星群（Meteor Showers）制御
// ==========================================

function updateMeteors(lst: number) {
  // 1. 流星群トグルがONの時、確率的に流星を生成
  if (showMeteors) {
    const shower = METEOR_SHOWERS[activeMeteorShower];
    if (shower) {
      const hor = equatorialToHorizontal(shower.ra, shower.dec, lst, latitude);
      
      // 放射点（ラジアント）が地平線上にある時のみ流星が出現
      if (hor.alt > 0) {
        // 出現確率 (1フレームあたり約 2.5%, 同時最大25本)
        if (Math.random() < 0.025 && activeMeteors.length < 25) {
          createMeteor(hor.az, hor.alt, shower.color);
        }
      }
    }
  }

  // 2. 既存の流星の更新・移動
  const nextMeteors: ActiveMeteor[] = [];
  activeMeteors.forEach((m) => {
    m.life += m.decay;
    if (m.life >= 1.0) {
      // 寿命が尽きたらシーンから削除してリソース破棄
      scene.remove(m.line);
      m.line.geometry.dispose();
      (m.line.material as THREE.Material).dispose();
    } else {
      // 流れ星の先端 (pStart) と末端 (pEnd) の3D位置を計算
      const progress = m.life * 1.8; // 移動スピードの加速感
      const pStart = m.origin.clone().addScaledVector(m.dir, progress * m.speed * DOME_RADIUS * 0.5);
      // ドームの球面に沿うように投影
      pStart.normalize().multiplyScalar(DOME_RADIUS * 0.95);
      
      const pEnd = pStart.clone().addScaledVector(m.dir, -m.length * DOME_RADIUS * 0.25);
      pEnd.normalize().multiplyScalar(DOME_RADIUS * 0.95);

      const positions = m.line.geometry.attributes.position.array as Float32Array;
      positions[0] = pStart.x;
      positions[1] = pStart.y;
      positions[2] = pStart.z;
      positions[3] = pEnd.x;
      positions[4] = pEnd.y;
      positions[5] = pEnd.z;
      m.line.geometry.attributes.position.needsUpdate = true;

      // フェードアウト効果 (中央が一番明るく、両端が薄くなる)
      const mat = m.line.material as THREE.LineBasicMaterial;
      mat.opacity = Math.sin(m.life * Math.PI) * 0.9;

      nextMeteors.push(m);
    }
  });
  activeMeteors = nextMeteors;
}

function createMeteor(radAz: number, radAlt: number, colorStr: string) {
  // 放射点の3D基準ベクトル (ドームの球面上)
  const radVector = horizonToCartesian(radAz, radAlt, DOME_RADIUS * 0.95);
  const radNormal = radVector.clone().normalize();
  
  // 流星の開始点（放射点の座標の周辺に少し揺らぎを与える）
  const origin = radVector.clone();
  const offset = new THREE.Vector3(
    (Math.random() - 0.5) * 60,
    (Math.random() - 0.5) * 60,
    (Math.random() - 0.5) * 60
  );
  origin.add(offset).normalize().multiplyScalar(DOME_RADIUS * 0.95);

  // 流星の進行方向 (放射ベクトルに直交する接線ベクトル)
  const tangent = new THREE.Vector3(1, 0, 0);
  if (Math.abs(radNormal.x) > 0.9) {
    tangent.set(0, 1, 0);
  }
  const dir = new THREE.Vector3().crossVectors(radNormal, tangent).normalize();
  
  // 放射点からランダムな角度 (360度方向) に飛び散るように回転
  const angle = Math.random() * Math.PI * 2;
  dir.applyAxisAngle(radNormal, angle);

  // 2頂点 (始点・終点) の Float32Array バッファを生成
  const positions = new Float32Array(6);
  positions[0] = origin.x; positions[1] = origin.y; positions[2] = origin.z;
  positions[3] = origin.x; positions[4] = origin.y; positions[5] = origin.z;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.LineBasicMaterial({
    color: new THREE.Color(colorStr),
    transparent: true,
    opacity: 0.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    linewidth: 1.5
  });

  const line = new THREE.Line(geo, mat);
  line.frustumCulled = false;
  scene.add(line);

  activeMeteors.push({
    line,
    origin,
    dir,
    speed: 0.08 + Math.random() * 0.12,  // 毎フレームの移動量
    length: 0.08 + Math.random() * 0.08, // 尾の長さ割合
    life: 0.0,
    decay: 0.025 + Math.random() * 0.045 // 寿命減少スピード
  });
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
    { id: 'NGC6543', file: 'ngc6543.png', ra: 17.977, dec: 66.633, scale: 8.0 },
    { id: 'Mercury', file: 'mercury.png', ra: 0, dec: 0, scale: 3.0 },
    { id: 'Uranus', file: 'uranus.png', ra: 0, dec: 0, scale: 3.0 },
    { id: 'Neptune', file: 'neptune.png', ra: 0, dec: 0, scale: 3.0 },
    { id: 'Pluto', file: 'pluto.png', ra: 0, dec: 0, scale: 2.5 }
  ];

  dsoConfigs.forEach(cfg => {
    loader.load(`/assets/${cfg.file}?v=${Date.now()}`, (texture) => {
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

  // 星座絵
  ART_CONFIGS.forEach(cfg => {
    // 保存されたアライメント設定があれば復元する
    const saved = localStorage.getItem(`art_${cfg.id}`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        cfg.offsetX = parsed.offsetX ?? cfg.offsetX;
        cfg.offsetY = parsed.offsetY ?? cfg.offsetY;
        cfg.scale = parsed.scale ?? cfg.scale;
        cfg.rotationOffset = parsed.rotationOffset ?? cfg.rotationOffset;
        cfg.flipX = parsed.flipX ?? cfg.flipX;
      } catch (e) {}
    }

    loader.load(`/assets/${cfg.file}?v=${Date.now()}`, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        blending: THREE.NormalBlending,
        depthWrite: false,
        opacity: 0.0,
        side: THREE.BackSide // 球の内側から見るため
      });
      const geometry = new THREE.PlaneGeometry(1, 1);
      const mesh = new THREE.Mesh(geometry, material);
      // 裏側から見ているため左右反転してしまうのを防ぐため、基本Xスケールをマイナスにする
      // さらに flipX が true ならもう一度反転（プラス）にする
      const baseScaleX = cfg.flipX ? cfg.scale : -cfg.scale;
      mesh.scale.set(baseScaleX, cfg.scale, 1);
      mesh.visible = false;
      scene.add(mesh);
      constellationArtObjects.set(cfg.id, mesh);
      console.log(`✓ Loaded constellation art: ${cfg.id}`);
    }, undefined, (err) => {
      console.error(`Failed to load constellation art: ${cfg.file}`, err);
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

    // 月食中は3Dスプライトを非表示にして2D Canvas描画（ブラッドムーン）に任せる
    if (isLunarEclipse && isTarget) {
      moonSprite.visible = false;
    } else if (moonData && isTarget) {
      // LST から高度を再計算（moonData.alt は古い値の可能性があるため）
      const hor = equatorialToHorizontal(moonData.ra, moonData.dec, lst, latitude);
      const pos3d = horizonToCartesian(hor.az, hor.alt, DOME_RADIUS - 10);
      moonSprite.position.copy(pos3d);

      const isAboveHorizon = hor.alt >= 0;
      const hasOpacity = maxOpacity > 0.05;
      moonSprite.visible = isAboveHorizon && hasOpacity;

      const mat = moonSprite.material as THREE.SpriteMaterial;
      mat.opacity = maxOpacity;
      mat.color.setRGB(1.0, 1.0, 1.0);
    } else {
      moonSprite.visible = false;
    }
  }



  const planetsToUpdate = ['Jupiter', 'Saturn', 'Venus', 'Mars', 'Mercury', 'Uranus', 'Neptune', 'Pluto'];
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
      const hor = equatorialToHorizontal(cfg.ra, cfg.dec, lst, latitude);
      const pos3d = horizonToCartesian(hor.az, hor.alt, DOME_RADIUS - 10);
      sprite.position.copy(pos3d);
      
      const isAboveHorizon = hor.alt >= 0;
      const isFOVMatched = fov <= 25.0; 
      
      if (isAboveHorizon && (isTarget || isFOVMatched) && maxOpacity > 0.05) {
        sprite.visible = true;
        (sprite.material as THREE.SpriteMaterial).opacity = maxOpacity;
      } else {
        sprite.visible = false;
      }
    }
  });

  // 星座絵の更新 (星座線表示時のみ、FOVに応じたアルファ)
  ART_CONFIGS.forEach(cfg => {
    const sprite = constellationArtObjects.get(cfg.id);
    if (sprite) {
      if (!showConstellations) {
        sprite.visible = false;
        return;
      }
      // パララクティック角（日周運動に伴う天体の傾き）を計算してSpriteを回転させる
      // const q = getParallacticAngle(cfg.ra, cfg.dec, lst, latitude);
      
      // オフセットを適用
      const horOffset = equatorialToHorizontal(cfg.ra + cfg.offsetX, cfg.dec + cfg.offsetY, lst, latitude);
      const pos3d = horizonToCartesian(horOffset.az, horOffset.alt, DOME_RADIUS - 20);
      sprite.position.copy(pos3d);
      
      // 天球に張り付くようにメッシュの向きを外側へ向ける
      sprite.lookAt(pos3d.x * 2, pos3d.y * 2, pos3d.z * 2);
      
      const isAboveHorizon = horOffset.alt >= -10; // 少し下まで描画
      let artOpacity = 0.0;
      
      // 透過画像＋NormalBlending なので上限を上げてしっかり見えるようにする
      if (fov >= 20.0) {
        artOpacity = Math.min(0.5, (fov - 20.0) / 40.0); // 最大不透明度 0.5 (Bloomによる発光を抑えるため)
      }
      
      if (isAboveHorizon && artOpacity > 0.01) {
        sprite.visible = true;
        const mat = sprite.material as THREE.MeshBasicMaterial;
        mat.opacity = artOpacity;
        // 天の北極（NCP）の方向を "上" とする
        const ncpPos = horizonToCartesian(0, latitude, 1);
        sprite.up.copy(ncpPos);
        
        // 独自オフセット（cfg.rotationOffset等）を考慮するため、一度リセットして適用
        sprite.lookAt(pos3d.x * 2, pos3d.y * 2, pos3d.z * 2);
        
        // Parallactic Angle (q) による回転は不要になったため、手動オフセットのみ適用
        const baseScaleX = cfg.flipX ? cfg.scale : -cfg.scale;
        const sign = baseScaleX < 0 ? -1 : 1;
        sprite.rotateZ(cfg.rotationOffset * sign);
      } else {
        sprite.visible = false;
      }
    }
  });
}

// ==========================================
// 星空クリック時の星座選択処理
// ==========================================

function handleConstellationClick(clientX: number, clientY: number) {
  if (Object.keys(constellationMeta).length === 0) return;

  const rect = webglCanvas.getBoundingClientRect();
  const mouseX = ((clientX - rect.left) / rect.width) * 2 - 1;
  const mouseY = -((clientY - rect.top) / rect.height) * 2 + 1;

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(mouseX, mouseY), camera);
  const dir = raycaster.ray.direction.clone().normalize();

  // calculations.ts の horizonToCartesian の逆変換で azimuth (az) と altitude (alt) を計算
  const altRad = Math.asin(Math.max(-1.0, Math.min(1.0, dir.y)));
  const clickAlt = altRad * 180.0 / Math.PI;
  const clickAz = (Math.atan2(dir.x, -dir.z) * 180.0 / Math.PI + 360.0) % 360.0;

  const jd = getJulianDate(currentDate);
  const lst = getLocalSiderealTime(jd, longitude);

  let closestCid: string | null = null;
  let minDistance = Infinity;
  const maxDistanceThreshold = 18.0; // 選択閾値（度）

  for (const cid in constellationMeta) {
    const meta = constellationMeta[cid];
    const hor = equatorialToHorizontal(meta.center_ra, meta.center_dec, lst, latitude);
    
    // 地平線下の星座は無視
    if (hor.alt < 0) continue;

    // クリックされた位置との角度差
    const dAlt = clickAlt - hor.alt;
    let dAz = clickAz - hor.az;
    if (dAz > 180.0) dAz -= 360.0;
    if (dAz < -180.0) dAz += 360.0;

    // 天球上の距離
    const dist = Math.sqrt(dAlt * dAlt + dAz * dAz * Math.cos(clickAlt * Math.PI / 180.0) * Math.cos(hor.alt * Math.PI / 180.0));

    if (dist < minDistance) {
      minDistance = dist;
      closestCid = cid;
    }
  }

  const constSelect = document.getElementById('constellation-select') as HTMLSelectElement;

  if (closestCid && minDistance <= maxDistanceThreshold) {
    showConstellationInfo(closestCid, constellationMeta);
    if (constSelect) {
      constSelect.value = closestCid;
    }
  } else {
    hideConstellationInfo();
    if (constSelect) {
      constSelect.value = '';
    }
  }
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
    if (cid) {
      showConstellationInfo(cid, constellationMeta);
      
      // 自動追尾等の状態をクリア
      isAutoRotatingToGuide = false;
      isPlanetLockOn = false;
      const lockCheckbox = document.getElementById('toggle-planet-lock') as HTMLInputElement;
      if (lockCheckbox) lockCheckbox.checked = false;
      const obsTargetSelect = document.getElementById('obs-target-select') as HTMLSelectElement;
      if (obsTargetSelect) obsTargetSelect.value = 'none';
      activeTrackPlanet = null;

      // 星座の中心位置へ自動回転
      const meta = constellationMeta[cid];
      if (meta && meta.center_ra !== undefined && meta.center_dec !== undefined) {
        const jd = getJulianDate(currentDate);
        const lst = getLocalSiderealTime(jd, longitude);
        const hor = equatorialToHorizontal(meta.center_ra, meta.center_dec, lst, latitude);
        
        guideTarget = { az: hor.az, alt: Math.max(15, hor.alt) };
        isAutoRotatingToGuide = true;
        showToast(`${meta.name_ja} に視点を移動します`, 'info');
      }
    } else {
      hideConstellationInfo();
    }
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

    // クリック判定用
    mouseDownX = e.clientX;
    mouseDownY = e.clientY;
    mouseDownTime = Date.now();
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

  window.addEventListener('mouseup', (e) => {
    if (isDragging) {
      isDragging = false;

      // クリック判定
      const dx = e.clientX - mouseDownX;
      const dy = e.clientY - mouseDownY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const timeDiff = Date.now() - mouseDownTime;

      // 移動量が非常に小さく、時間も短ければクリックとみなす
      if (dist < 5 && timeDiff < 300) {
        handleConstellationClick(e.clientX, e.clientY);
      }
    }
  });

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

      // タッチクリック判定用
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchStartTime = Date.now();
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

  webglCanvas.addEventListener('touchend', (e) => {
    if (e.changedTouches.length === 1) {
      const touchEndX = e.changedTouches[0].clientX;
      const touchEndY = e.changedTouches[0].clientY;
      const dx = touchEndX - touchStartX;
      const dy = touchEndY - touchStartY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const timeDiff = Date.now() - touchStartTime;

      if (dist < 5 && timeDiff < 300) {
        handleConstellationClick(touchEndX, touchEndY);
      }
    }
  });

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
  
  // デバッグ＆微調整用：星座絵のアライメント調整機能
  window.addEventListener('keydown', (e) => {
    if (!showConstellations) return;
    
    // 画面中央に一番近い星座絵を対象とする
    const jd = getJulianDate(currentDate);
    const lst = getLocalSiderealTime(jd, longitude);

    let closestCfg: any = null;
    let minDistance = Infinity;

    ART_CONFIGS.forEach(c => {
      const hor = equatorialToHorizontal(c.ra + c.offsetX, c.dec + c.offsetY, lst, latitude);
      let azDiff = Math.abs(hor.az - viewAzimuth);
      if (azDiff > 180) azDiff = 360 - azDiff;
      const altDiff = Math.abs(hor.alt - viewAltitude);
      const dist = Math.sqrt(azDiff*azDiff + altDiff*altDiff);
      
      if (dist < minDistance) {
        minDistance = dist;
        closestCfg = c;
      }
    });

    if (!closestCfg || minDistance > 60) return; // 画面内に見えていなければ無視
    const cfg = closestCfg;

    const step = 0.5;
    let changed = false;
    if (e.key === 'ArrowUp') { cfg.offsetY += step; changed = true; }
    if (e.key === 'ArrowDown') { cfg.offsetY -= step; changed = true; }
    if (e.key === 'ArrowLeft') { cfg.offsetX -= step; changed = true; } // 右回りの空なので左は-RA
    if (e.key === 'ArrowRight') { cfg.offsetX += step; changed = true; }
    if (e.key === 'PageUp') { cfg.scale *= 1.05; changed = true; }
    if (e.key === 'PageDown') { cfg.scale /= 1.05; changed = true; }
    if (e.key === 'q' || e.key === 'Q') { cfg.rotationOffset -= 0.05; changed = true; }
    if (e.key === 'e' || e.key === 'E') { cfg.rotationOffset += 0.05; changed = true; }
    if (e.key === 'f' || e.key === 'F') { cfg.flipX = !cfg.flipX; changed = true; }

    if (changed) {
       console.log(`${cfg.id}: offsetX=${cfg.offsetX.toFixed(2)}, offsetY=${cfg.offsetY.toFixed(2)}, scale=${cfg.scale.toFixed(2)}, rotation=${cfg.rotationOffset.toFixed(2)}, flipX=${cfg.flipX}`);
       const sprite = constellationArtObjects.get(cfg.id);
       if (sprite) {
         const baseScaleX = cfg.flipX ? cfg.scale : -cfg.scale;
         sprite.scale.set(baseScaleX, cfg.scale, 1);
       }
       // LocalStorageに保存して次回起動時も維持する
       localStorage.setItem(`art_${cfg.id}`, JSON.stringify({
         offsetX: cfg.offsetX,
         offsetY: cfg.offsetY,
         scale: cfg.scale,
         rotationOffset: cfg.rotationOffset,
         flipX: cfg.flipX
       }));
       
       // 画面上に調整状態を表示する
       showToast(`調整保存: X:${cfg.offsetX.toFixed(1)} Y:${cfg.offsetY.toFixed(1)} 拡大:${cfg.scale.toFixed(0)} 回転:${cfg.rotationOffset.toFixed(2)} 反転:${cfg.flipX}`, 'info');
    }
  });

  window.addEventListener('resize', resizeViewport);
  resizeViewport();
  setTimeout(resizeViewport, 100);

  // --- 拡張機能：光害レベル (Bortle Scale) ---
  const bortleScaleSlider = document.getElementById('bortle-scale') as HTMLInputElement;
  const bortleLabel = document.getElementById('bortle-label')!;
  if (bortleScaleSlider && bortleLabel) {
    bortleScaleSlider.addEventListener('input', () => {
      bortleScale = parseInt(bortleScaleSlider.value);
      bortleLabel.textContent = String(bortleScale);
      showToast(`光害レベルを Bortle ${bortleScale} に変更しました`, 'info');
    });
  }

  // --- 拡張機能：流星群トグル & 種類 ---
  const toggleMeteorsCheckbox = document.getElementById('toggle-meteors') as HTMLInputElement;
  const meteorShowerSelect = document.getElementById('meteor-shower-select') as HTMLSelectElement;
  
  if (toggleMeteorsCheckbox && meteorShowerSelect) {
    toggleMeteorsCheckbox.addEventListener('change', () => {
      showMeteors = toggleMeteorsCheckbox.checked;
      if (showMeteors) {
        // 既存の流星をクリア
        activeMeteors.forEach(m => {
          scene.remove(m.line);
          m.line.geometry.dispose();
          (m.line.material as THREE.Material).dispose();
        });
        activeMeteors = [];
        const showerName = METEOR_SHOWERS[activeMeteorShower]?.name || '流星群';
        showToast(`${showerName} を表示します`, 'info');
      } else {
        showToast('流星群を非表示にしました', 'info');
      }
    });

    meteorShowerSelect.addEventListener('change', () => {
      activeMeteorShower = meteorShowerSelect.value;
      if (showMeteors) {
        const showerName = METEOR_SHOWERS[activeMeteorShower]?.name || '流星群';
        showToast(`流星群を ${showerName} に切り替えました`, 'info');
      }
    });
  }

  // --- 拡張機能：天体イベントプリセット ---
  const celestialEventSelect = document.getElementById('celestial-event-select') as HTMLSelectElement;
  if (celestialEventSelect) {
    celestialEventSelect.addEventListener('change', () => {
      const eventKey = celestialEventSelect.value;
      if (!eventKey) return;

      const ev = CELESTIAL_EVENTS[eventKey];
        if (ev) {
        if (isTimelapseActive) stopTimelapse();

        // ★ 月食・日食イベントとして記録（エフェクト制御に使用）
        activeCelestialEventKey = eventKey;

        latitude = ev.lat;
        longitude = ev.lng;
        currentDate = new Date(ev.date);


        const latInput = document.getElementById('input-lat') as HTMLInputElement;
        const lngInput = document.getElementById('input-lng') as HTMLInputElement;
        const dateInput = document.getElementById('input-date') as HTMLInputElement;
        const sitePreset = document.getElementById('site-preset') as HTMLSelectElement;
        
        if (latInput) latInput.value = String(latitude);
        if (lngInput) lngInput.value = String(longitude);
        if (dateInput) dateInput.value = formatDate(currentDate);
        if (sitePreset) sitePreset.value = 'tokyo';

        // イベント用オートタイムラプスの設定
        if (ev.timelapseStart && ev.timelapseEnd) {
          timelapseStartSimTime = new Date(ev.timelapseStart);
          timelapseEndSimTime = new Date(ev.timelapseEnd);
          timelapseDuration = 25000; // 25秒で食の開始から終了までを再生
          currentDate = new Date(timelapseStartSimTime.getTime());
          timelapseStartTime = Date.now();
          isTimelapseActive = true;

          const toggleBtn = document.getElementById('btn-timelapse-toggle')!;
          if (toggleBtn) {
            toggleBtn.textContent = 'タイムラプス停止';
            toggleBtn.className = 'btn btn-danger';
          }
          const progressContainer = document.getElementById('timelapse-progress-container')!;
          if (progressContainer) progressContainer.style.display = 'block';

          const timeFlowCheckbox = document.getElementById('toggle-time-flow') as HTMLInputElement;
          const speedSlider = document.getElementById('time-speed') as HTMLInputElement;
          if (timeFlowCheckbox) timeFlowCheckbox.disabled = true;
          if (speedSlider) speedSlider.disabled = true;
          if (dateInput) dateInput.disabled = true;
        }

        loadFromAPI().then(() => {

          if (ev.target && ev.target !== 'none') {
            activeTrackPlanet = ev.target;
            isPlanetLockOn = true;

            const obsTargetSelect = document.getElementById('obs-target-select') as HTMLSelectElement;
            const obsModeSelect = document.getElementById('obs-mode-select') as HTMLSelectElement;
            const obsModeDetails = document.getElementById('obs-mode-details')!;
            const obsModeDesc = document.getElementById('obs-mode-desc')!;
            const lockCheckbox = document.getElementById('toggle-planet-lock') as HTMLInputElement;

            if (obsTargetSelect) obsTargetSelect.value = ev.target;
            if (obsModeSelect) obsModeSelect.value = 'telescope';
            observationMode = 'telescope';
            camera.fov = ev.fov || 1.5;
            camera.updateProjectionMatrix();

            setObsModeDescription(obsModeDesc, 'telescope');
            if (obsModeDetails) obsModeDetails.style.display = 'block';
            if (lockCheckbox) lockCheckbox.checked = true;

            const initJd = getJulianDate(currentDate);
            const initLst = getLocalSiderealTime(initJd, longitude);
            
            let targetAz: number | null = null;
            let targetAlt: number | null = null;
            
            const trackP = planetsData.find(p => p.name === ev.target);
            if (trackP) {
              const hor = equatorialToHorizontal(trackP.ra, trackP.dec, initLst, latitude);
              targetAz = hor.az;
              targetAlt = hor.alt;
            }

            if (targetAz !== null && targetAlt !== null) {
              guideTarget = { az: targetAz, alt: Math.max(12, targetAlt) };
              isAutoRotatingToGuide = true;
            }
          }
        });

        showToast(`タイムトラベル: ${ev.name}`, 'info');
        setTimeout(() => {
          showToast(ev.description, 'info');
        }, 2200);
      }
    });
  }
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
    if (!window.hasOwnProperty('lastTimeUpdate')) {
      (window as any).lastTimeUpdate = Date.now();
    }
    const now = Date.now();
    const deltaMs = now - (window as any).lastTimeUpdate;
    currentDate = new Date(currentDate.getTime() + deltaMs * timeSpeed);
    (window as any).lastTimeUpdate = now;
    
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

// ==========================================
// 拡張機能ロジック (Tween, Satellites, Meteors, UI)
// ==========================================

interface TweenAnim { start: number; end: number; startTime: number; duration: number; onUpdate: (v: number) => void; onComplete?: () => void; }
const tweens: TweenAnim[] = [];
function updateTweens(now: number) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const t = tweens[i];
    let p = (now - t.startTime) / t.duration;
    if (p > 1) p = 1;
    const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    t.onUpdate(t.start + (t.end - t.start) * ease);
    if (p >= 1) {
      if (t.onComplete) t.onComplete();
      tweens.splice(i, 1);
    }
  }
}
function tweenTo(start: number, end: number, duration: number, onUpdate: (v:number)=>void, onComplete?: ()=>void) {
  tweens.push({ start, end, startTime: performance.now(), duration, onUpdate, onComplete });
}

let satellitesData: any[] = [];
let satellitesSprites: Map<string, THREE.Sprite> = new Map();
async function fetchSatellites() {
  const timeStr = encodeURIComponent(currentDate.toISOString());
  try {
    const res = await fetch(`${API_BASE}/api/satellites?lat=${latitude}&lng=${longitude}&time=${timeStr}`);
    if (res.ok) {
      const data = await res.json();
      satellitesData = data.satellites || [];
      updateSatelliteSprites();
    }
  } catch (err) {}
}
function updateSatelliteSprites() {
  satellitesData.forEach(sat => {
    let sprite = satellitesSprites.get(sat.id);
    if (!sprite) {
      const tex = createStarTexture(sat.color);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending });
      sprite = new THREE.Sprite(mat);
      sprite.scale.set(8, 8, 1);
      scene.add(sprite);
      satellitesSprites.set(sat.id, sprite);
    }
    const { x, y, z } = horizonToCartesian(sat.az, sat.alt, DOME_RADIUS - 10);
    sprite.position.set(x, y, z);
    sprite.visible = sat.alt > -5;
  });
}


function focusOnObject(az: number, alt: number) {
  let targetAz = az;
  let diff = targetAz - viewAzimuth;
  while (diff > 180) diff -= 360;
  while (diff < -180) diff += 360;
  tweenTo(viewAzimuth, viewAzimuth + diff, 1200, (v) => viewAzimuth = v);
  tweenTo(viewAltitude, alt, 1200, (v) => viewAltitude = v);
  tweenTo(baseFov, 25, 1200, (v) => { baseFov = v; camera.fov = baseFov; camera.updateProjectionMatrix(); });
}

function initEnhancedEvents() {
  document.getElementById('btn-gps')?.addEventListener('click', () => {
    if (navigator.geolocation) {
      showToast('現在地を取得中...', 'info');
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          latitude = pos.coords.latitude;
          longitude = pos.coords.longitude;
          (document.getElementById('input-lat') as HTMLInputElement).value = latitude.toFixed(2);
          (document.getElementById('input-lng') as HTMLInputElement).value = longitude.toFixed(2);
          showToast('現在地を更新しました', 'info');
          loadFromAPI();
        },
        () => showToast('現在地の取得に失敗しました', 'error')
      );
    }
  });

  const timeTravelSlider = document.getElementById('time-travel-slider') as HTMLInputElement;
  if (timeTravelSlider) {
    timeTravelSlider.addEventListener('input', (e) => {
      const daysOffset = parseInt((e.target as HTMLInputElement).value, 10);
      currentDate = new Date(Date.now() + daysOffset * 24 * 60 * 60 * 1000);
      const dateInput = document.getElementById('input-date') as HTMLInputElement;
      if (dateInput) dateInput.value = formatDate(currentDate);
    });
    timeTravelSlider.addEventListener('change', () => loadFromAPI());
  }

  const searchBox = document.getElementById('search-box') as HTMLInputElement;
  const searchSuggests = document.getElementById('search-suggestions') as HTMLUListElement;
  if (searchBox && searchSuggests) {
    searchBox.addEventListener('input', () => {
      const q = searchBox.value.toLowerCase();
      searchSuggests.innerHTML = '';
      if (!q) { searchSuggests.style.display = 'none'; return; }
      const results: any[] = [];
      starsData.forEach(s => { if ((s.name_ja && s.name_ja.toLowerCase().includes(q))) results.push({...s, type: '恒星'}); });
      planetsData.forEach(p => { if ((p.name_ja && p.name_ja.toLowerCase().includes(q)) || (p.name && p.name.toLowerCase().includes(q))) results.push({...p, type: '惑星'}); });
      dsoData.forEach(d => { if ((d.name_ja && d.name_ja.toLowerCase().includes(q)) || (d.name_en && d.name_en.toLowerCase().includes(q))) results.push({...d, type: 'DSO'}); });
      satellitesData.forEach(sat => { if ((sat.name_ja && sat.name_ja.toLowerCase().includes(q)) || (sat.name && sat.name.toLowerCase().includes(q))) results.push({...sat, type: '衛星'}); });
      
      if (results.length > 0) {
        searchSuggests.style.display = 'block';
        results.slice(0, 5).forEach(r => {
          const li = document.createElement('li');
          li.textContent = `[${r.type}] ${r.name_ja || r.name}`;
          li.style.cursor = 'pointer';
          li.style.padding = '6px';
          li.style.borderBottom = '1px solid rgba(255,255,255,0.1)';
          li.style.color = '#fff';
          li.onmouseover = () => li.style.background = 'rgba(0,188,212,0.3)';
          li.onmouseout = () => li.style.background = 'transparent';
          li.onclick = () => {
            searchBox.value = '';
            searchSuggests.style.display = 'none';
            focusOnObject(r.az, r.alt);
          };
          searchSuggests.appendChild(li);
        });
      } else {
        searchSuggests.style.display = 'none';
      }
    });
  }

  const toggleMeteors = document.getElementById('toggle-meteors') as HTMLInputElement;
  if (toggleMeteors) {
    toggleMeteors.addEventListener('change', (e) => {
      showMeteors = (e.target as HTMLInputElement).checked;
    });
  }
  const meteorShowerSelect = document.getElementById('meteor-shower-select') as HTMLSelectElement;
  if (meteorShowerSelect) {
    meteorShowerSelect.addEventListener('change', (e) => {
      activeMeteorShower = (e.target as HTMLSelectElement).value;
    });
  }
}

function tick() {
  updateTime();
  updateTweens(performance.now());

  const interval = isTimelapseActive ? PLANETS_DSO_TIMELAPSE_UPDATE_INTERVAL_MS : PLANETS_DSO_UPDATE_INTERVAL_MS;
  if (Date.now() - planetsDsoLastUpdate > interval) {
    refreshPlanetsAndDSO();
    fetchSatellites();
  }

  updatePositionsAndRender();
}

// ==========================================
// 起動
// ==========================================

async function start() {
  viewAltitude = 5;

  initWorker();
  init3D();
  initEvents();
  initEnhancedEvents();
  await loadFromAPI();
  if (Object.keys(constellationMeta).length > 0) {
    populateConstellationSelect(constellationMeta);
  }
  showToast(`Stellaris 起動完了 - ${starsData.length}星 / 88星座 / 惑星${planetsData.length}`, 'info');
  introStartTime = performance.now();
  
  renderer.setAnimationLoop(tick);
}

window.addEventListener('DOMContentLoaded', start);
