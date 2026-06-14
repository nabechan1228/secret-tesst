import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';



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
  az: number;
  alt: number;
}

// ==========================================
// グローバル状態
// ==========================================

let latitude = 35.68;
let longitude = 139.76;

let currentDate = new Date();
let isTimeFlowing = true;
let timeSpeed = 1;

let viewAzimuth = 180;
let viewAltitude = 45;
let baseFov = 85; // 超広角（人間の視野に近い85°）

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

let constellationPositions = new Float32Array(10002); // 初期サイズを十分に大きく（10002要素 = 1667セグメント、3の倍数）確保
let starWorker: Worker | null = null;
let isWorkerComputing = false;

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
    color: 0x4499ff,
    transparent: true,
    opacity: 0.45,
    linewidth: 1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  constellationMesh = new THREE.LineSegments(constGeo, constMat);
  scene.add(constellationMesh);

  // ========== 天の川 ==========
  buildMilkyWay();
}

// ==========================================
// データロード (APIから)
// ==========================================

async function loadFromAPI(): Promise<void> {
  const statusEl = document.getElementById('loading-status');
  if (statusEl) statusEl.textContent = 'APIからデータ取得中...';

  try {
    const metaRes = await fetch('http://localhost:8000/api/constellations');
    if (metaRes.ok) {
      const metaData = await metaRes.json();
      constellationMeta = metaData.constellations;
    }

    const skyRes = await fetch(
      `http://localhost:8000/api/sky?lat=${latitude}&lng=${longitude}&mag_limit=6.0`
    );
    if (!skyRes.ok) throw new Error('Sky API error');
    const skyData = await skyRes.json();

    starsData = skyData.stars;
    constellationLinesData = skyData.constellation_lines;
    planetsData = skyData.planets || [];
    dsoData = skyData.deep_sky_objects || [];
    planetsDsoLastUpdate = Date.now();

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
        constellationMesh.visible = true;
      } else if (constellationMesh) {
        constellationMesh.visible = false;
      }

      isWorkerComputing = false;
    }
  };
}

function updateStarSpritesFromBuffer(coords: Float32Array) {
  const count = starsData.length;
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const star = starsData[i];
    const sprite = starObjects.get(star.id);
    if (sprite) {
      const idx = i * 4;
      const x = coords[idx];
      const y = coords[idx + 1];
      const z = coords[idx + 2];
      const isVisible = coords[idx + 3] === 1.0;
      
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
    drawDSO();
  }
}



// ==========================================
// 惑星描画
// ==========================================

function drawPlanets(lst: number) {
  planetsData.forEach((planet) => {
    const hor = equatorialToHorizontal(planet.ra, planet.dec, lst, latitude);
    if (hor.alt < 0) return;

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

    const labelOffset = baseSize * 3 + 8;
    ctx2d.textAlign = 'left';
    ctx2d.textBaseline = 'middle';
    ctx2d.font = `bold 12px 'Outfit', sans-serif`;
    ctx2d.fillStyle = 'rgba(0,0,0,0.75)';
    ctx2d.fillText(planet.name_ja, scr.x + labelOffset + 1, scr.y + 1);
    ctx2d.fillStyle = `rgba(${r + 60 > 255 ? 255 : r + 60}, ${g + 40 > 255 ? 255 : g + 40}, ${b + 20 > 255 ? 255 : b + 20}, 0.95)`;
    ctx2d.fillText(planet.name_ja, scr.x + labelOffset, scr.y);
  });
}

// ==========================================
// DSO（深宇宙天体）描画
// ==========================================

function drawDSO() {
  dsoData.forEach((obj) => {
    if (obj.alt < 0) return;

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

  nameEl.innerHTML = `<span class="const-name-ja">${meta.name_ja}</span> <span class="const-name-en">${meta.name_en}</span>`;
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

  const formatDate = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  dateInput.value = formatDate(currentDate);

  dateInput.addEventListener('blur', () => {
    const parsed = Date.parse(dateInput.value.replace(' ', 'T'));
    if (!isNaN(parsed)) currentDate = new Date(parsed);
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

  // ドラッグでカメラ回転
  webglCanvas.addEventListener('mousedown', (e) => {
    isDragging = true;
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
    // 広角85°〜望遠10°の広いズーム範囲（超広角視点が最大の3D感）
    camera.fov = Math.max(10.0, Math.min(100.0, camera.fov * (e.deltaY < 0 ? (1/1.08) : 1.08)));
    camera.updateProjectionMatrix();
  }, { passive: false });

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

function updateTime() {
  if (isTimeFlowing) {
    currentDate = new Date(currentDate.getTime() + 16.7 * timeSpeed);
    const dateInput = document.getElementById('input-date') as HTMLInputElement;
    if (document.activeElement !== dateInput) {
      const pad = (n: number) => String(n).padStart(2, '0');
      dateInput.value = `${currentDate.getFullYear()}-${pad(currentDate.getMonth()+1)}-${pad(currentDate.getDate())} ${pad(currentDate.getHours())}:${pad(currentDate.getMinutes())}:${pad(currentDate.getSeconds())}`;
    }
  }
}

async function refreshPlanetsAndDSO() {
  planetsDsoLastUpdate = Date.now();
  try {
    const skyRes = await fetch(
      `http://localhost:8000/api/sky?lat=${latitude}&lng=${longitude}&mag_limit=6.0`
    );
    if (!skyRes.ok) return;
    const skyData = await skyRes.json();
    planetsData = skyData.planets || [];
    dsoData = skyData.deep_sky_objects || [];
    starsData = skyData.stars;
    constellationLinesData = skyData.constellation_lines;

    allocateConstellationBuffer();
    buildStarSprites();
    syncStarsToWorker();
  } catch (_) {
    // サイレントに失敗
  }
}

function tick() {
  updateTime();

  if (Date.now() - planetsDsoLastUpdate > PLANETS_DSO_UPDATE_INTERVAL_MS) {
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
