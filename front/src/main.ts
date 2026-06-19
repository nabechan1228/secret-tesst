import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

// S-5/R-3: APIベースURLを環境変数に一元化（ハードコード禁止）
const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:8000';



// ==========================================
// 型定義
// ==========================================

interface StarData {
  id: number;
  ra: number;
  dec: number;
  mag: number;
  bv: number;
  color: string;
  az: number;
  alt: number;
  name_ja?: string | null;
}

interface ConstellationSegment {
  ra1: number; dec1: number;
  ra2: number; dec2: number;
}

interface ConstellationLineData {
  cid: string;
  segments: ConstellationSegment[];
}

interface ConstellationMeta {
  name_ja: string;
  name_en: string;
  name_la: string;
  season: string;
  desc: string;
  center_ra: number;
  center_dec: number;
  rank: number;
}

interface PlanetRecommendation {
  name: string;
  name_ja: string;
  score: number;
  mag: number;
  max_alt: number;
  visible_hours: number;
  time_range: string;
  comment: string;
}

interface PlanetData {
  name: string;
  name_ja: string;
  ra: number;
  dec: number;
  az: number;
  alt: number;
  color: string;
  mag: number;
  dist_au: number;
}

interface DSOData {
  id: string;
  name_ja: string;
  name_en: string;
  type: string;
  size: number;
  mag: number;
  ra: number;
  dec: number;
  az: number;
  alt: number;
}

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
let observationMode: 'none' | 'binoculars' | 'telescope' = 'none';
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
const PLANETS_DSO_UPDATE_INTERVAL_MS = 30000;
const PLANETS_DSO_TIMELAPSE_UPDATE_INTERVAL_MS = 1500; // タイムラプス中は1.5秒ごとに更新

// R-5: DSO座標の重複定義を一元化（main.ts 内3箇所で重複していたものをここに集約）
const DSO_FIXED_COORDS: Record<string, { ra: number; dec: number }> = {
  M31: { ra: 0.7122, dec: 41.2692 },
  M42: { ra: 5.5883, dec: -5.39 },
  M45: { ra: 3.7883, dec: 24.1167 },
  M6: { ra: 17.668, dec: -32.217 },
  M7: { ra: 17.899, dec: -34.817 },
  M11: { ra: 18.852, dec: -6.267 },
  M15: { ra: 21.500, dec: 12.167 },
  M24: { ra: 18.281, dec: -18.417 },
  M35: { ra: 6.148, dec: 24.333 },
  M78: { ra: 5.778, dec: 0.083 },
  M83: { ra: 13.618, dec: -29.867 },
  M90: { ra: 12.614, dec: 13.167 },
  IC434: { ra: 5.685, dec: -2.460 },
  NGC2237: { ra: 6.538, dec: 5.017 },
  NGC869: { ra: 2.333, dec: 57.143 },
  NGC7000: { ra: 20.983, dec: 44.333 },
  NGC6960: { ra: 20.762, dec: 30.714 },
  NGC7293: { ra: 22.493, dec: -20.835 },
  NGC6543: { ra: 17.977, dec: 66.633 },
};

// タイムラプス状態変数
let isTimelapseActive = false;
let timelapseStartTime = 0;
let timelapseDuration = 0; // ms
let timelapseStartSimTime = new Date();
let timelapseEndSimTime = new Date();

let constellationPositions = new Float32Array(10002); // 初期サイズを十分に大きく（10002要素 = 1667セグメント、3の倍数）確保
let starWorker: Worker | null = null;
let isWorkerComputing = false;

// ==========================================
// 星座・星群ガイド用の定義と状態
// ==========================================
interface AsterismGuide {
  name_ja: string;
  name_en: string;
  desc: string;
  season: string;
  starIds: number[];
  linePairs: [number, number][];
}

const ASTERISM_GUIDES: Record<string, AsterismGuide> = {
  'summer-triangle': {
    name_ja: '夏の大三角',
    name_en: 'Summer Triangle',
    desc: 'こと座のベガ、わし座のアルタイル、はくちょう座のデネブを結んでできる巨大な三角形。天の川をまたぐように配置されており、夏の夜空を象徴する重要な目印です。',
    season: '🌸〜🍂 夏（見頃は7月〜9月）',
    starIds: [91262, 97649, 102098], // ベガ, アルタイル, デネブ
    linePairs: [[0, 1], [1, 2], [2, 0]]
  },
  'winter-triangle': {
    name_ja: '冬の大三角',
    name_en: 'Winter Triangle',
    desc: 'おおいぬ座 of シリウス、こいぬ座のプロキオン、オリオン座のベテルギウスを結んでできる正三角形。冬の夜空でひときわ明るく輝く恒星たちの共演です。',
    season: '🍂〜🌸 冬（見頃は12月〜3月）',
    starIds: [32349, 37279, 27989], // シリウス, プロキオン, ベテルギウス
    linePairs: [[0, 1], [1, 2], [2, 0]]
  },
  'spring-triangle': {
    name_ja: '春の大三角',
    name_en: 'Spring Triangle',
    desc: 'うしかい座のアークトゥルス、おとめ座のスピカ、しし座のデネボラを結んでできる広大な三角形。春の穏やかな夜空に大きく描かれます。',
    season: '❄️〜☀️ 春（見頃は4月〜6月）',
    starIds: [69673, 65474, 57632], // アークトゥルス, スピカ, デネボラ (HIP 57632)
    linePairs: [[0, 1], [1, 2], [2, 0]]
  },
  'big-dipper': {
    name_ja: '北斗七星',
    name_en: 'Big Dipper',
    desc: 'おおぐま座の腰と尾を構成する7つの明るい星。ひしゃくの形をしており、古来より北極星を見つけるためのガイドとして使われてきました。',
    season: '🌐 通年（春に最も高く昇る）',
    starIds: [54061, 53910, 58001, 59774, 62956, 65378, 67301], // ドゥーベ, メラク, フェクダ, メグレズ, アリオト, ミザール, アルカイド
    linePairs: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [3, 0]]
  },
  'cassiopeia': {
    name_ja: 'カシオペヤ座 (W字)',
    name_en: 'Cassiopeia (W-shape)',
    desc: '秋の北天で美しく輝くW字型の星群。北極星を挟んで北斗七星のちょうど反対側にあり、北（北極星）を特定する重要な指標です。',
    season: '🌐 通年（秋に最も高く昇る）',
    starIds: [8886, 6686, 4427, 3179, 746], // セギン, ルクバー, ツィー, シェダル, カフ
    linePairs: [[0, 1], [1, 2], [2, 3], [3, 4]]
  }
};

let activeGuideId: string | null = null;
let guideTarget: { az: number; alt: number } | null = null;
let isAutoRotatingToGuide = false;

const DOME_RADIUS = 500;

// ==========================================
// 奥行きレイヤー定数（視差効果のため距離を分離）
// ==========================================
const LAYER_MILKYWAY  = 900;  // 天の川（最奥）
// WebWorker に移行されたためメインスレッド側では未使用
// const LAYER_DIM       = 650;  // 暗い星 mag 4〜6
// const LAYER_MID       = 500;  // 中間 mag 2〜4
// const LAYER_BRIGHT    = 350;  // 明るい星 mag < 2
// const LAYER_CONSTEL   = 480;  // 星座線

/** 等級から配置半径を決定
    WebWorker に移行されたためメインスレッド側では未使用
function starLayerRadius(mag: number): number {
  if (mag < 2.0)  return LAYER_BRIGHT;
  if (mag < 4.0)  return LAYER_MID;
  return LAYER_DIM;
}
*/

/** 等級から指数関数的サイズを計算（光の強さを体感に近い形で表現） */
function starVisualScale(mag: number): number {
  // 天文学的フラックス比: 5等級差 = 100倍 → 1等級差 = 2.512倍
  // 視覚サイズは sqrt(flux) に比例 → 2.512^0.5 ≈ 1.585倍/等級
  const flux = Math.pow(10, -0.4 * mag); // 相対フラックス
  const baseSize = Math.pow(flux, 0.45) * 42.0; // 非線形マッピング
  return Math.max(0.5, Math.min(28.0, baseSize));
}

// ==========================================
// イントロアニメ状態
// ==========================================
let introActive = true;
let introProgress = 0; // 0.0 → 1.0
const INTRO_DURATION = 3000; // ms
let introStartTime = 0;

// ==========================================
// 天体計算アルゴリズム
// ==========================================

function getJulianDate(date: Date): number {
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

function getLocalSiderealTime(jd: number, lng: number): number {
  const t = (jd - 2451545.0) / 36525.0;
  let gmst = 280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * t * t - (t * t * t) / 38710000.0;
  gmst = ((gmst % 360.0) + 360.0) % 360.0;
  return ((gmst + lng) % 360.0 + 360.0) % 360.0;
}

function equatorialToHorizontal(ra: number, dec: number, lstDeg: number, latDeg: number): { az: number; alt: number } {
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

function horizonToCartesian(azDeg: number, altDeg: number, radius: number): THREE.Vector3 {
  const az = azDeg * Math.PI / 180.0;
  const alt = altDeg * Math.PI / 180.0;
  return new THREE.Vector3(
    radius * Math.cos(alt) * Math.sin(az),
    radius * Math.sin(alt),
    -radius * Math.cos(alt) * Math.cos(az)
  );
}

const tempV = new THREE.Vector3();
function getScreenPosition(pos3d: THREE.Vector3): { x: number; y: number; visible: boolean } {
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

// ==========================================
// テクスチャ生成
// ==========================================

const textureCache: Map<string, THREE.Texture> = new Map();

function createStarTexture(color: string): THREE.Texture {
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
function createMilkyWayTexture(): THREE.Texture {
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

  // 銀河面（銀緯0°付近、銀経0〜360°）に沿ってパーティクルを配置
  // 銀河面の傾き（赤道座標系における）を近似する
  // 銀河面を赤道傾斜（約62°）で傾けた帯として表現
  for (let i = 0; i < COUNT; i++) {
    // 銀経（0〜360°）と銀緯（ガウス分布で±15°以内に集中）
    const galLon = Math.random() * Math.PI * 2;
    const galLat = (Math.random() - 0.5) * 0.5; // ±14°程度

    // 銀河座標から赤道座標への変換（簡略版）
    // 銀河北極: RA=192.85°, Dec=27.13°, 銀河中心: RA=266.4°, Dec=-28.9°
    const sinB = Math.sin(galLat);
    const cosB = Math.cos(galLat);

    // 銀河座標系から赤道座標系への変換行列（J2000.0）
    // NGP: ra=192.8595°, dec=27.1284°
    // Node: 122.9319°
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

    // 赤道座標→3D球面座標（天の川は最遠レイヤーへ配置）
    const r = LAYER_MILKYWAY - 8 + Math.random() * 16;
    positions[i * 3 + 0] = r * Math.cos(dec) * Math.cos(ra);
    positions[i * 3 + 1] = r * Math.sin(dec);
    positions[i * 3 + 2] = -r * Math.cos(dec) * Math.sin(ra);

    // 色: 青白〜白〜微黄色のランダム
    const t = Math.random();
    colors[i * 3 + 0] = 0.7 + t * 0.3;
    colors[i * 3 + 1] = 0.75 + t * 0.25;
    colors[i * 3 + 2] = 0.85 + (1 - t) * 0.15;

    // サイズ: 中心部に近い（ランダムで小〜大）
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
// 山並みシルエット生成（オクルージョンで3D感を強制）
// ==========================================

/**
 * 地平線を囲む低ポリゴン山並みをプロシージャルに生成する。
 * - 複数の sin 波を重ね合わせてフラクタル的な山稜線を作成
 * - 完全な黒（depthWrite:true）で背景を遮蔽 → オクルージョン効果
 * - カメラと同じ原点を向くため、視点回転に追随して「手前の山が奥の星を隠す」
 */
function buildMountainSilhouette(): THREE.Group {
  const group = new THREE.Group();

  const SEGMENTS  = 360;         // 水平分割数（細かいほど滑らか）
  const BASE_R    = 220;         // 山の底辺（星空レイヤー 350〜650 より手前に置いて確実に星を隠す）
  const MAX_H     = 50;          // 山の最大高さ（見かけの高さ比率を維持）
  const DEPTH     = 60;          // 地面方向の厚み

  // 山稜線の高さをプロシージャルに生成
  // 複数の sin 波を重ね合わせてフラクタル的な凸凹を作る
  const heights: number[] = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const t = (i / SEGMENTS) * Math.PI * 2;
    // 周波数と振幅の異なる5つの波を重畳
    const h =
      Math.sin(t * 3.0 + 0.5)  * 0.35 * MAX_H +
      Math.sin(t * 7.0 + 1.2)  * 0.25 * MAX_H +
      Math.sin(t * 13.0 + 2.8) * 0.15 * MAX_H +
      Math.sin(t * 23.0 + 0.9) * 0.08 * MAX_H +
      Math.sin(t * 41.0 + 3.5) * 0.04 * MAX_H +
      MAX_H * 0.25; // ベースライン（最低高さ）
    heights.push(Math.max(8, h));
  }

  // ジオメトリ構築: 各セグメントを三角形2枚（クワッド）で形成
  const positions: number[] = [];
  const indices:   number[] = [];

  for (let i = 0; i < SEGMENTS; i++) {
    const t0 = (i / SEGMENTS) * Math.PI * 2;
    const t1 = ((i + 1) / SEGMENTS) * Math.PI * 2;
    const h0 = heights[i];
    const h1 = heights[i + 1];

    // 底辺（地面 y=-DEPTH）と頂点（y=高さ）の4頂点
    const x0b = BASE_R * Math.sin(t0);
    const z0b = -BASE_R * Math.cos(t0);
    const x1b = BASE_R * Math.sin(t1);
    const z1b = -BASE_R * Math.cos(t1);

    const base = positions.length / 3;

    // 頂点0: 左下（地面）
    positions.push(x0b, -DEPTH, z0b);
    // 頂点1: 右下（地面）
    positions.push(x1b, -DEPTH, z1b);
    // 頂点2: 左上（山頂）
    positions.push(x0b, h0, z0b);
    // 頂点3: 右上（山頂）
    positions.push(x1b, h1, z1b);

    // 三角形2枚でクワッドを構成（反時計回りに修正して内側からの描画を可能に）
    indices.push(base + 0, base + 1, base + 2);
    indices.push(base + 1, base + 3, base + 2);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  geo.computeBoundingBox();

  // 1. 完全不透明の黒ボディ（星や天の川を遮蔽するための実体）
  const mat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    side: THREE.DoubleSide, // 確実に描画されるよう両面に設定
    depthWrite: true,
    depthTest: true,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  group.add(mesh);

  // 2. 山の側面ワイヤーフレーム（ローポリゴンの立体感を醸し出す）
  const edgesGeo = new THREE.EdgesGeometry(geo, 20); // しきい値20度
  const edgesMat = new THREE.LineBasicMaterial({
    color: 0x0f2d6b,       // やや明るくしたディープブルー（星空に溶け込まない）
    transparent: true,
    opacity: 0.65,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const lines = new THREE.LineSegments(edgesGeo, edgesMat);
  lines.frustumCulled = false;
  group.add(lines);

  // 3. 山頂の稜線（トップのアウトライン）を輝かせる（ネオンワイヤー風）
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
    color: 0x00ffcc,       // 鮮烈なネオンシアン（大気光と明確なコントラスト）
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

  // 大気散乱を模した深い青黒フォグ（地平線付近が霞む）
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

  // ========== EffectComposer (Bloom) ==========
  composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    1.8,   // strength（強めに）
    0.55,  // radius
    0.02   // threshold（暗い星は光らせない → コントラスト強調）
  );
  composer.addPass(bloomPass);

  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  // ========== 地面（不透明な円盤で地平線下を隠す） ==========
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

  // ========== 山並みシルエット（オクルージョンで3D感を強制） ==========
  mountainMesh = buildMountainSilhouette();
  scene.add(mountainMesh);

  // ========== 大気散乱リング（地平線のグロー） ==========
  // 地平線付近に浮かぶ青いグロー帯（大気散乱の表現）
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

  // 内側のより明るいグロー帯
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

  // ========== 天頂方向の薄い円（穹窿感を強調） ==========
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

  // ========== 天球回転グループ（すべての恒星・星座線・天の川を格納） ==========
  celestialSphereGroup = new THREE.Group();
  scene.add(celestialSphereGroup);

  // ========== 星座線 ==========
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

  // ========== 天の川 ==========
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
    // S-5: ハードコードされた localhost:8000 を API_BASE に置き換え
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

// R-4: API呼び出しの共通関数（loadFromAPI と refreshPlanetsAndDSO の重複を排除）
async function fetchSkyData(): Promise<Record<string, unknown> | null> {
  // S-5: API_BASE 使用
  const skyRes = await fetch(
    `${API_BASE}/api/sky?lat=${latitude}&lng=${longitude}&mag_limit=6.0`
  );
  if (!skyRes.ok) {
    console.warn(`Sky API responded with status: ${skyRes.status}`);
    return null;
  }
  return skyRes.json();
}

// R-4: データ適用の共通関数
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

  // ターゲット天体の位置を取得
  let targetRa = -1;
  let targetDec = -100;
  if (activeTrackPlanet && observationMode !== 'none') {
    const trackP = planetsData.find(p => p.name === activeTrackPlanet);
    if (trackP) {
      targetRa = trackP.ra;
      targetDec = trackP.dec;
    } else {
      // R-5: DSO_FIXED_COORDS から座標を取得（ローカル変数による重複定義を廃止）
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
      
      // ターゲット天体の近くにある背景恒星を一時的に非表示にする
      if (isVisible && targetRa !== -1) {
        const dDec = star.dec - targetDec;
        let dRa = (star.ra - targetRa) * 15.0; // 時間 -> 度
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
    // init 直後に座標を更新（Worker 初期化完了後に星座線を描画）
    const jd = getJulianDate(currentDate);
    const lst = getLocalSiderealTime(jd, longitude);
    isWorkerComputing = true;
    starWorker.postMessage({ type: 'update', lst, latitude });
  }
}

function allocateConstellationBuffer() {
  const totalSegments = constellationLinesData.reduce((acc, c) => acc + c.segments.length, 0);
  const requiredLength = totalSegments * 6; // 1セグメントあたり 2点 * 3次元 = 6要素
  if (requiredLength > constellationPositions.length) {
    resizeConstellationBuffer(requiredLength);
  }
}

function resizeConstellationBuffer(newLength: number) {
  // 3の倍数に切り上げ
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

    // 指数関数的サイズ（明るい星と暗い星の光量差を現実に近く表現）
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
    const scr = getScreenPosition(pos3d);
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
  const scr20 = getScreenPosition(pos20);
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

  // イーズアウト（cubic）
  const t = 1 - Math.pow(1 - introProgress, 3);

  // 高度: 5° → 25°
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

  // ダッシュボード更新
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

  // イントロアニメ
  if (introActive) updateIntroCamera();

  const now = Date.now();

  // 1. 各星 of 3D位置更新（WebWorker にオフロード）
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

  // 2. 星座線の更新（WebWorker側で計算・適用されるため、ここでは表示切替のみ）
  if (constellationMesh) {
    constellationMesh.visible = showConstellations && constellationLinesData.length > 0;
  }

  // 天の川の回転更新
  if (milkyWayParticles) {
    const q1 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), lst * Math.PI / 180.0);
    const q2 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (latitude - 90.0) * Math.PI / 180.0);
    milkyWayParticles.quaternion.multiplyQuaternions(q2, q1);
  }

  // ガイド自動回転追従と惑星自動追尾
  if (isAutoRotatingToGuide && guideTarget) {
    let diffAz = guideTarget.az - viewAzimuth;
    if (diffAz > 180) diffAz -= 360;
    if (diffAz < -180) diffAz += 360;

    const diffAlt = guideTarget.alt - viewAltitude;

    viewAzimuth = (viewAzimuth + diffAz * 0.05 + 360) % 360;
    viewAltitude = viewAltitude + diffAlt * 0.05;

    // 目標位置に十分近づいたら自動回転を終了（ただし自動追尾中は除く）
    if (!isPlanetLockOn && Math.abs(diffAz) < 0.1 && Math.abs(diffAlt) < 0.1) {
      isAutoRotatingToGuide = false;
    }
  } else if (isPlanetLockOn && activeTrackPlanet) {
    // 描画と同じ LST でリアルタイム計算した座標を追尾ターゲットとして使用する。
    // サーバー提供の az/alt は更新間隔や時刻ズレで誤差が生じるため使わない。
    let targetAz: number | null = null;
    let targetAlt: number | null = null;

    const trackP = planetsData.find(p => p.name === activeTrackPlanet);
    if (trackP) {
      // フロントエンドの現在 LST で再計算
      const hor = equatorialToHorizontal(trackP.ra, trackP.dec, lst, latitude);
      targetAz = hor.az;
      targetAlt = hor.alt;
    } else {
      // DSO: dsoData に ra/dec が含まれていれば再計算、なければ固定座標から計算
      const trackD = dsoData.find(d => d.id === activeTrackPlanet);
      if (trackD) {
        const hor = equatorialToHorizontal(trackD.ra, trackD.dec, lst, latitude);
        targetAz = hor.az;
        targetAlt = hor.alt;
      } else {
        // R-5: DSO リストに無い場合も DSO_FIXED_COORDS を参照（ハードコード座標を廃止）
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

      // 自動追尾中はスムーズに追従 (イージング係数 0.08)
      viewAzimuth = (viewAzimuth + diffAz * 0.08 + 360) % 360;
      viewAltitude = viewAltitude + diffAlt * 0.08;
    }
  }

  // 3. カメラ向き更新
  const camAzRad = viewAzimuth * Math.PI / 180.0;
  const camAltRad = viewAltitude * Math.PI / 180.0;
  let targetX = Math.cos(camAltRad) * Math.sin(camAzRad);
  let targetY = Math.sin(camAltRad);
  let targetZ = -Math.cos(camAltRad) * Math.cos(camAzRad);
  if (isNaN(targetX) || isNaN(targetY) || isNaN(targetZ)) {
    targetX = 0; targetY = 1; targetZ = -0.1;
  }
  camera.lookAt(new THREE.Vector3(targetX, targetY, targetZ));

  // 4. 大気リングのパルス（呼吸するような光）
  if (atmosphereRing) {
    const atmoMat = atmosphereRing.material as THREE.MeshBasicMaterial;
    atmoMat.opacity = 0.08 + 0.04 * Math.sin(now * 0.0008);
  }

  // 5. Bloomパラメータをズームに合わせて動的調整
  //    望遠時: threshold上げて明るい星だけ爆発 → コントラスト最大化
  //    広角時: 全体的なグロー感を重視
  if (bloomPass) {
    const zoomFactor = baseFov / camera.fov; // >1 で望遠、<1 で超広角
    bloomPass.strength = 1.6 + zoomFactor * 0.5;
    bloomPass.threshold = Math.max(0.0, 0.15 * (zoomFactor - 0.5));
  }

  // 7. WebGL（Bloom付き）レンダリング
  composer.render();

  // 8. 2Dオーバーレイ描画
  ctx2d.clearRect(0, 0, w, h);

  // 光害グラデーション
  drawLightPollution(w, h, lst);

  // 明るい星の名前
  if (showStarNames) {
    ctx2d.font = "11px 'Outfit', sans-serif";
    ctx2d.textBaseline = "middle";

    starsData.forEach((star) => {
      if (star.mag > 2.2) return;

      const hor = equatorialToHorizontal(star.ra, star.dec, lst, latitude);
      if (hor.alt < 0) return;

      const pos3d = horizonToCartesian(hor.az, hor.alt, DOME_RADIUS);
      const scr = getScreenPosition(pos3d);
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

  // 方位ラベル
  const directions = [
    { name: "N", az: 0 }, { name: "E", az: 90 },
    { name: "S", az: 180 }, { name: "W", az: 270 }
  ];
  ctx2d.font = "bold 13px 'Outfit', sans-serif";
  ctx2d.textAlign = "center";
  directions.forEach((dir) => {
    const pos3d = horizonToCartesian(dir.az, 0, DOME_RADIUS);
    const scr = getScreenPosition(pos3d);
    if (scr.visible) {
      ctx2d.fillStyle = 'rgba(0,0,0,0.8)';
      ctx2d.fillText(dir.name, scr.x + 1, scr.y + 1);
      ctx2d.fillStyle = 'rgba(0, 188, 212, 0.85)';
      ctx2d.fillText(dir.name, scr.x, scr.y);
    }
  });

  // 惑星描画
  if (showPlanets && planetsData.length > 0) {
    drawPlanets(lst);
  }

  // DSO描画
  if (showDSO && dsoData.length > 0) {
    drawDSO(lst);
  }

  // 星座・星群ガイド表示
  if (activeGuideId) {
    drawAsterismGuide(lst);
  }

  // 天体写真 (DSO/月) の 3D位置とフェード更新
  updateDsoPhotos(lst);

  // 観測モードの視野マスク・レチクル描画
  drawObservationMask(w, h);
}



// ==========================================
// 惑星描画
// ==========================================

function drawPlanets(lst: number) {
  planetsData.forEach((planet) => {
    const hor = equatorialToHorizontal(planet.ra, planet.dec, lst, latitude);
    if (hor.alt < 0) return;

    // 現在ターゲット指定され観測モード中の天体は2D惑星マークの描画をスキップする
    if (activeTrackPlanet === planet.name && observationMode !== 'none') {
      return;
    }

    const pos3d = horizonToCartesian(hor.az, hor.alt, DOME_RADIUS);
    const scr = getScreenPosition(pos3d);
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

    // 強調ターゲットエフェクトの描画 (見頃または自動追尾中)
    if (isRecommended || isTracked) {
      const now = Date.now();
      ctx2d.save();

      const pulse1 = 1.0 + 0.12 * Math.sin(now * 0.005);
      const pulse2 = 1.25 - 0.08 * Math.cos(now * 0.005);

      const r1 = baseSize * 2.2 * pulse1;
      const r2 = baseSize * 2.8 * pulse2;

      const glowColor = isTracked ? 'rgba(0, 230, 246, 0.85)' : 'rgba(255, 201, 71, 0.85)';
      const shadowColor = isTracked ? 'rgba(0, 230, 246, 0.4)' : 'rgba(255, 201, 71, 0.4)';

      // 外側破線リング
      ctx2d.strokeStyle = glowColor;
      ctx2d.lineWidth = 1.2;
      ctx2d.shadowColor = shadowColor;
      ctx2d.shadowBlur = 6;
      ctx2d.setLineDash([4, 4]);
      ctx2d.beginPath();
      ctx2d.arc(scr.x, scr.y, r2, 0, Math.PI * 2);
      ctx2d.stroke();
      ctx2d.setLineDash([]);

      // 内側実線リング
      ctx2d.lineWidth = 1.8;
      ctx2d.beginPath();
      ctx2d.arc(scr.x, scr.y, r1, 0, Math.PI * 2);
      ctx2d.stroke();

      // 十字スコープ線
      ctx2d.strokeStyle = isTracked ? 'rgba(0, 230, 246, 0.5)' : 'rgba(255, 201, 71, 0.5)';
      ctx2d.lineWidth = 1.0;
      const crossSize = baseSize * 3.5;
      ctx2d.beginPath();
      // 上
      ctx2d.moveTo(scr.x, scr.y - r1 - 2);
      ctx2d.lineTo(scr.x, scr.y - crossSize);
      // 下
      ctx2d.moveTo(scr.x, scr.y + r1 + 2);
      ctx2d.lineTo(scr.x, scr.y + crossSize);
      // 左
      ctx2d.moveTo(scr.x - r1 - 2, scr.y);
      ctx2d.lineTo(scr.x - crossSize, scr.y);
      // 右
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
      ctx2d.fillStyle = '#ffc947'; // ゴールド
    } else if (isTracked) {
      ctx2d.fillStyle = '#00e6f6'; // シアン
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
    // フロント側で現在の地方恒星時と緯度からリアルタイム地平座標変換
    const hor = equatorialToHorizontal(obj.ra, obj.dec, lst, latitude);
    obj.az = hor.az;
    obj.alt = hor.alt;

    if (obj.alt < -15.0) return;

    // 現在ターゲット指定され観測モード中の天体は2Dマークの描画をスキップする
    if (activeTrackPlanet === obj.id && observationMode !== 'none') {
      return;
    }

    const pos3d = horizonToCartesian(obj.az, obj.alt, DOME_RADIUS);
    const scr = getScreenPosition(pos3d);
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

  // 1. 各星の現在位置を計算・投影
  guide.starIds.forEach((sid) => {
    const star = starsData.find(s => s.id === sid);
    if (!star) {
      starPositions.push({ x: 0, y: 0, visible: false, name: `HIP ${sid}`, alt: -90 });
      return;
    }

    const hor = equatorialToHorizontal(star.ra, star.dec, lst, latitude);
    const pos3d = horizonToCartesian(hor.az, hor.alt, DOME_RADIUS);
    const scr = getScreenPosition(pos3d);
    
    starPositions.push({
      x: scr.x,
      y: scr.y,
      visible: scr.visible && hor.alt >= 0,
      name: star.name_ja || `HIP ${sid}`,
      alt: hor.alt
    });
  });

  ctx2d.save();

  // 2. ガイドライン（黄金の破線）の描画
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
  ctx2d.setLineDash([]); // ダッシュ解除

  // 3. ターゲットマーカー（パルス照準器）の描画
  starPositions.forEach((pos) => {
    if (!pos.visible) return;

    const pulse = 1.0 + 0.12 * Math.sin(now * 0.005 + pos.x);
    const baseRadius = 14;
    const r1 = baseRadius * pulse;
    const r2 = (baseRadius + 5) * (1.1 - 0.08 * Math.sin(now * 0.005 + pos.x));

    // 外側の薄い拡散リング
    ctx2d.strokeStyle = 'rgba(255, 201, 71, 0.28)';
    ctx2d.lineWidth = 1.0;
    ctx2d.beginPath();
    ctx2d.arc(pos.x, pos.y, r2, 0, Math.PI * 2);
    ctx2d.stroke();

    // 内側の明瞭なリング
    ctx2d.strokeStyle = 'rgba(255, 201, 71, 0.85)';
    ctx2d.lineWidth = 1.5;
    ctx2d.shadowColor = 'rgba(255, 201, 71, 0.5)';
    ctx2d.shadowBlur = 8;
    ctx2d.beginPath();
    ctx2d.arc(pos.x, pos.y, r1, 0, Math.PI * 2);
    ctx2d.stroke();
    ctx2d.shadowBlur = 0; // シャドウ解除

    // 中心点
    ctx2d.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx2d.beginPath();
    ctx2d.arc(pos.x, pos.y, 2.5, 0, Math.PI * 2);
    ctx2d.fill();

    // 星の名称表示
    ctx2d.font = "bold 12px 'Outfit', 'Noto Sans JP', sans-serif";
    ctx2d.textAlign = 'center';
    ctx2d.textBaseline = 'top';

    const textY = pos.y + baseRadius + 8;
    ctx2d.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx2d.fillText(pos.name, pos.x + 1, textY + 1);
    ctx2d.fillStyle = '#ffc947'; // 明るいゴールド
    ctx2d.fillText(pos.name, pos.x, textY);
  });

  // 4. 地平線下警告表示
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

  // 1. マスク領域を描画（外側を黒く塗りつぶす）
  ctx2d.beginPath();
  ctx2d.rect(0, 0, w, h);
  ctx2d.arc(cx, cy, radius, 0, Math.PI * 2, true);
  ctx2d.fillStyle = 'rgba(2, 3, 10, 0.98)';
  ctx2d.fill();

  // 2. 円の境界にケラレ（ソフトなボケ）をグラデーションで描画
  const grad = ctx2d.createRadialGradient(cx, cy, radius - 20, cx, cy, radius + 2);
  grad.addColorStop(0, 'rgba(2, 3, 10, 0)');
  grad.addColorStop(0.5, 'rgba(2, 3, 10, 0.4)');
  grad.addColorStop(1, 'rgba(2, 3, 10, 0.98)');
  
  ctx2d.beginPath();
  ctx2d.arc(cx, cy, radius + 5, 0, Math.PI * 2);
  ctx2d.fillStyle = grad;
  ctx2d.fill();

  // 3. アイピースの内枠線を描画（金属反射の表現）
  ctx2d.strokeStyle = 'rgba(80, 100, 140, 0.25)';
  ctx2d.lineWidth = 2.0;
  ctx2d.beginPath();
  ctx2d.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx2d.stroke();

  // 4. モード固有のレチクルや情報を描画
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
        blending: THREE.NormalBlending, // NormalBlending にして背景の星を遮蔽する
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

  // 1. 月の更新
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

  // 2. 惑星の更新 (木星、土星、金星、火星)
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

  // 3. DSO天体の更新
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
// 惑星見頃・追跡UI更新
// ==========================================

function updatePlanetTrackerUI() {
  const infoEl = document.getElementById('planet-tracker-info');
  const controlsEl = document.getElementById('planet-tracker-controls');
  if (!infoEl || !controlsEl) return;

  if (!planetRecommendation || planetRecommendation.score === 0) {
    infoEl.innerHTML = '';
    const msgEl = document.createElement('div');
    msgEl.style.cssText = 'font-size:0.82rem;color:var(--text-muted);';
    msgEl.textContent = '今夜は肉眼で見頃な惑星はありません。';
    infoEl.appendChild(msgEl);
    controlsEl.style.display = 'none';
    return;
  }

  // S-6: innerHTML でサーバーデータを直接展開するのを廃止し、DOM操作に変更（XSS対策）
  infoEl.innerHTML = '';

  // 見頃ラベル行
  const titleEl = document.createElement('div');
  titleEl.style.cssText = 'font-size:0.9rem;font-weight:bold;color:var(--gold);margin-bottom:6px;display:flex;align-items:center;gap:4px;';
  titleEl.textContent = `🪐 今夜の見頃: ${planetRecommendation.name_ja} (${planetRecommendation.name})`;
  infoEl.appendChild(titleEl);

  // 詳細行
  const detailEl = document.createElement('div');
  detailEl.style.cssText = 'font-size:0.75rem;color:var(--text-secondary);margin-bottom:6px;line-height:1.4;';
  detailEl.textContent = `明るさ: ${planetRecommendation.mag}等 / 最大高度: ${planetRecommendation.max_alt}°`;
  const brEl = document.createElement('br');
  detailEl.appendChild(brEl);
  detailEl.append(`時間帯: ${planetRecommendation.time_range}`);
  infoEl.appendChild(detailEl);

  // コメント行
  const commentEl = document.createElement('div');
  commentEl.style.cssText = 'font-size:0.78rem;color:var(--text-primary);line-height:1.6;background:rgba(255,255,255,0.03);padding:10px;border-radius:10px;border:1px solid rgba(80,160,255,0.08);';
  commentEl.textContent = planetRecommendation.comment; // textContent でXSS回避
  infoEl.appendChild(commentEl);

  controlsEl.style.display = 'flex';
}

// ==========================================
// 星座情報パネル
// ==========================================

function showConstellationInfo(cid: string) {
  const meta = constellationMeta[cid];
  if (!meta) return;

  const panel = document.getElementById('constellation-info-panel')!;
  const nameEl = document.getElementById('const-name')!;
  const descEl = document.getElementById('const-desc')!;
  const seasonEl = document.getElementById('const-season')!;

  const seasonMap: Record<string, string> = {
    'spring': '🌸 春', 'summer': '☀️ 夏',
    'autumn': '🍂 秋', 'winter': '❄️ 冬', 'all': '🌐 全天'
  };

  // S-6: innerHTML でサーバーデータを直接展開するのを廃止し、DOM操作に変更（XSS対策）
  nameEl.textContent = '';
  const jaSpan = document.createElement('span');
  jaSpan.className = 'const-name-ja';
  jaSpan.textContent = meta.name_ja;
  nameEl.appendChild(jaSpan);
  nameEl.append(' ');
  const enSpan = document.createElement('span');
  enSpan.className = 'const-name-en';
  enSpan.textContent = meta.name_en;
  nameEl.appendChild(enSpan);
  descEl.textContent = meta.desc;
  seasonEl.textContent = seasonMap[meta.season] || meta.season;

  panel.classList.add('visible');
}

function hideConstellationInfo() {
  const panel = document.getElementById('constellation-info-panel')!;
  panel.classList.remove('visible');
}

// ==========================================
// トースト通知
// ==========================================

function showToast(msg: string, type: 'info' | 'error' = 'info') {
  const toast = document.getElementById('toast')!;
  toast.textContent = msg;
  toast.className = `toast toast-${type} visible`;
  setTimeout(() => { toast.classList.remove('visible'); }, 4000);
}

// ==========================================
// 日時フォーマット
// ==========================================
function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ==========================================
// 観測モード説明の DOM 操作ヘルパー（innerHTML 注入廃止・XSS 対策）
// ==========================================

type ObsMode = 'none' | 'binoculars' | 'telescope';

function setObsModeDescription(el: HTMLElement, mode: ObsMode) {
  el.textContent = '';

  type ModeConfig = { title: string; specs: string[]; note: string };
  const configs: Record<Exclude<ObsMode, 'none'>, ModeConfig> = {
    binoculars: {
      title: '双眼鏡シミュレーション (7x50 相当)',
      specs: [
        '・倍率: 7倍 / 対物有効径: 50mm',
        '・実視野 (TFOV): 7.5°',
        '・ズーム制限: 4.0° 〜 15.0° (ホイール操作可)',
      ],
      note: '手軽に星域をスキャンするのに最適です。天の川や明るい星団が美しく見えます。',
    },
    telescope: {
      title: '望遠鏡シミュレーション (中倍率・レチクル)',
      specs: [
        '・口径: 200mm / 焦点距離: 1000mm (F5)',
        '・実視野 (TFOV): 1.0° (レチクル照準付き)',
        '・ズーム制限: 0.2° 〜 4.0° (ホイール操作可)',
      ],
      note: '月、惑星の表面、遠方の星雲・星団（DSO）をクローズアップして観測できます。',
    },
  };

  if (mode === 'none') return;
  const cfg = configs[mode];

  const strong = document.createElement('strong');
  strong.textContent = cfg.title;
  el.appendChild(strong);

  cfg.specs.forEach(spec => {
    el.appendChild(document.createElement('br'));
    el.append(spec);
  });

  el.appendChild(document.createElement('br'));
  const noteSpan = document.createElement('span');
  noteSpan.style.cssText = 'color:var(--text-secondary); opacity: 0.8; font-size: 0.72rem;';
  noteSpan.textContent = cfg.note;
  el.appendChild(noteSpan);
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

    // 初期ジャンプ先もフロントエンドの現在時刻で計算した座標を使う
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
        // R-5: DSO_FIXED_COORDS から取得（重複定義廃止）
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
    const val = obsModeSelect.value as 'none' | 'binoculars' | 'telescope';
    observationMode = val;

    if (val === 'none') {
      camera.fov = baseFov;
      camera.updateProjectionMatrix();
      obsModeDetails.style.display = 'none';
      
      // 通常モードに戻した際はターゲット選択と自動追尾も解除する
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
    if (cid) showConstellationInfo(cid);
    else hideConstellationInfo();
  });

  document.getElementById('close-const-panel')?.addEventListener('click', () => {
    hideConstellationInfo();
    constSelect.value = '';
  });

  // 惑星追跡・自動追尾のイベントリスナー
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
      // 追尾開始時はスムーズに向くようにする
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

  // ドラッグでカメラ回転
  webglCanvas.addEventListener('mousedown', (e) => {
    isDragging = true;
    isAutoRotatingToGuide = false; // 手動ドラッグ時に自動回転を即座にキャンセル
    isPlanetLockOn = false; // 自動追尾もキャンセル
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
    if (introActive) { introActive = false; } // ドラッグでイントロスキップ
    const dx = e.clientX - startMouseX;
    const dy = e.clientY - startMouseY;
    const sensitivity = 0.15 * (camera.fov / 60.0);
    viewAzimuth = ((startAzimuth + dx * sensitivity) % 360.0 + 360.0) % 360.0;
    viewAltitude = Math.max(2.0, Math.min(89.9, startAltitude - dy * sensitivity));
  });

  window.addEventListener('mouseup', () => { isDragging = false; });

  // タッチ操作
  let lastTouchX = 0, lastTouchY = 0;
  webglCanvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      isAutoRotatingToGuide = false; // タッチドラッグ開始時に自動追従を解除
      isPlanetLockOn = false; // 自動追尾もキャンセル
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

  // ホイールズーム
  webglCanvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    
    // 観測モードごとにズーム範囲を制限
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

  // タイムラプス操作
  const timelapseToggleBtn = document.getElementById('btn-timelapse-toggle')!;
  timelapseToggleBtn.addEventListener('click', () => {
    if (isTimelapseActive) {
      stopTimelapse();
      showToast('タイムラプスを停止しました', 'info');
    } else {
      startTimelapse();
    }
  });

  // 星座ガイド操作
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

      // 構成星の日本語名を取得
      const starNames: string[] = [];
      guide.starIds.forEach((sid) => {
        const star = starsData.find(s => s.id === sid);
        if (star) {
          starNames.push(star.name_ja || `HIP ${sid}`);
        }
      });
      guideStars.textContent = `構成星: ${starNames.join('、')}`;

      // ガイド中心の地平座標を計算し、カメラの自動フォーカスを起動
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

  // リサイズ対応
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
// 星座セレクトボックスを動的に生成
// ==========================================

function populateConstellationSelect() {
  const select = document.getElementById('constellation-select') as HTMLSelectElement;
  select.innerHTML = '<option value="">-- 星座を選択 --</option>';

  const seasonOrder = ['spring', 'summer', 'autumn', 'winter', 'all'];
  const seasonNames: Record<string, string> = {
    spring: '春の星座', summer: '夏の星座',
    autumn: '秋の星座', winter: '冬の星座', all: '周極星座'
  };

  const grouped: Record<string, Array<[string, ConstellationMeta]>> = {};
  seasonOrder.forEach(s => grouped[s] = []);

  Object.entries(constellationMeta).forEach(([cid, meta]) => {
    const season = meta.season || 'all';
    if (!grouped[season]) grouped[season] = [];
    grouped[season].push([cid, meta]);
  });

  seasonOrder.forEach(season => {
    const entries = grouped[season];
    if (!entries || entries.length === 0) return;
    entries.sort((a, b) => a[1].name_ja.localeCompare(b[1].name_ja, 'ja'));
    const optgroup = document.createElement('optgroup');
    optgroup.label = seasonNames[season];
    entries.forEach(([cid, meta]) => {
      const opt = document.createElement('option');
      opt.value = cid;
      opt.textContent = `${meta.name_ja} (${meta.name_en})`;
      optgroup.appendChild(opt);
    });
    select.appendChild(optgroup);
  });
}

// ==========================================
// 更新ループ
// ==========================================

function startTimelapse() {
  const preset = (document.getElementById('timelapse-preset') as HTMLSelectElement).value;
  
  // 現在のシミュレーション時刻を開始時点とする
  timelapseStartSimTime = new Date(currentDate.getTime());
  
  if (preset === 'sunset-to-sunrise') {
    // タイムラプス当日の18:00から翌朝06:00までの12時間
    timelapseStartSimTime.setHours(18, 0, 0, 0);
    timelapseEndSimTime = new Date(timelapseStartSimTime.getTime() + 12 * 60 * 60 * 1000);
    timelapseDuration = 30000; // 30秒
  } else if (preset === '24hours') {
    timelapseEndSimTime = new Date(timelapseStartSimTime.getTime() + 24 * 60 * 60 * 1000);
    timelapseDuration = 30000; // 30秒
  } else if (preset === '1year') {
    timelapseEndSimTime = new Date(timelapseStartSimTime.getTime() + 365 * 24 * 60 * 60 * 1000);
    timelapseDuration = 60000; // 60秒
  }

  currentDate = new Date(timelapseStartSimTime.getTime());
  timelapseStartTime = Date.now();
  isTimelapseActive = true;

  // UI状態の更新
  const toggleBtn = document.getElementById('btn-timelapse-toggle')!;
  toggleBtn.textContent = 'タイムラプス停止';
  toggleBtn.className = 'btn btn-danger';
  
  document.getElementById('timelapse-progress-container')!.style.display = 'block';
  
  // 通常時間操作UIを無効化
  (document.getElementById('toggle-time-flow') as HTMLInputElement).disabled = true;
  (document.getElementById('time-speed') as HTMLInputElement).disabled = true;
  (document.getElementById('input-date') as HTMLInputElement).disabled = true;

  showToast('タイムラプスを開始しました', 'info');
  
  // 開始時に即座に天体座標同期
  refreshPlanetsAndDSO();
}

function stopTimelapse() {
  isTimelapseActive = false;
  
  const toggleBtn = document.getElementById('btn-timelapse-toggle')!;
  toggleBtn.textContent = 'タイムラプス開始';
  toggleBtn.className = 'btn btn-accent';
  
  document.getElementById('timelapse-progress-container')!.style.display = 'none';

  // 時間操作UIを有効化
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

    // プログレス表示更新
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

async function refreshPlanetsAndDSO() {
  try {
    // R-4: 共通関数 fetchSkyData を使用
    const skyData = await fetchSkyData();
    if (!skyData) {
      // S-7: サイレント失敗を廃止し、警告ログを残す
      console.warn('refreshPlanetsAndDSO: Sky API が失敗しました（更新をスキップ）');
      return;
    }
    
    // 静的データ（恒星・星座線）はロード時のままとし、動的データのみを更新
    planetsData = (skyData.planets as PlanetData[]) || [];
    dsoData = (skyData.deep_sky_objects as DSOData[]) || [];
    planetRecommendation = (skyData.recommendation as PlanetRecommendation) || null;
    planetsDsoLastUpdate = Date.now();

    updatePlanetTrackerUI();
  } catch (err) {
    // S-7: エラーをコンソールに記録（完全な握りつぶし廃止）
    console.warn('refreshPlanetsAndDSO: 例外が発生しました:', err);
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
  // イントロ: カメラを地面近くから開始
  viewAltitude = 5;

  initWorker();
  init3D();
  initEvents();
  await loadFromAPI();
  if (Object.keys(constellationMeta).length > 0) {
    populateConstellationSelect();
  }
  showToast(`Stellaris 起動完了 - ${starsData.length}星 / 88星座 / 感星${planetsData.length}`, 'info');
  introStartTime = performance.now();
  tick();
}

window.addEventListener('DOMContentLoaded', start);
