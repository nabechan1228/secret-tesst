import * as THREE from 'three';

// ==========================================
// 型定義
// ==========================================

interface StarData {
  id: number;     // HIP番号
  ra: number;     // 赤経 (時間)
  dec: number;    // 赤緯 (度)
  mag: number;    // 等級
  bv: number;     // B-V色指数
  color: string;  // 星の色 (hex)
  az: number;     // 方位角
  alt: number;    // 高度
}

interface ConstellationSegment {
  az1: number; alt1: number;
  az2: number; alt2: number;
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

// 観測地設定 (デフォルト: 東京)
let latitude = 35.68;
let longitude = 139.76;

// 時間設定
let currentDate = new Date();
let isTimeFlowing = true;
let timeSpeed = 1;

// 視野設定
let viewAzimuth = 180;
let viewAltitude = 45;
let baseFov = 60;

// 描画設定
let showConstellations = true;
let showStarNames = true;
let showPlanets = true;
let showDSO = true;

// マウスインタラクション
let isDragging = false;
let startMouseX = 0;
let startMouseY = 0;
let startAzimuth = 180;
let startAltitude = 45;

// WebGL & 2D Overlay
let webglCanvas: HTMLCanvasElement;
let overlayCanvas: HTMLCanvasElement;
let ctx2d: CanvasRenderingContext2D;

let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGLRenderer;

// 3Dオブジェクト
const starObjects: Map<number, THREE.Sprite> = new Map();
let constellationMesh: THREE.LineSegments;

// 星データ (APIから取得)
let starsData: StarData[] = [];
let constellationLinesData: ConstellationLineData[] = [];
let constellationMeta: Record<string, ConstellationMeta> = {};
let planetsData: PlanetData[] = [];
let dsoData: DSOData[] = [];

// 惑星・DSO 更新タイマー
let planetsDsoLastUpdate = 0;
const PLANETS_DSO_UPDATE_INTERVAL_MS = 30000; // 30秒ごとに更新

// 星座線バッファ (最大 1500セグメント × 2頂点 × 3成分)
const MAX_CONST_SEGMENTS = 1500;
const constellationPositions = new Float32Array(MAX_CONST_SEGMENTS * 2 * 3);

const DOME_RADIUS = 500;

// ==========================================
// 天体計算アルゴリズム (クライアントサイド)
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
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;

  // 色をRGBに分解
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);

  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0.0, `rgba(255, 255, 255, 1.0)`);
  grad.addColorStop(0.12, `rgba(${r}, ${g}, ${b}, 1.0)`);
  grad.addColorStop(0.35, `rgba(${r}, ${g}, ${b}, 0.55)`);
  grad.addColorStop(0.70, `rgba(${r}, ${g}, ${b}, 0.1)`);
  grad.addColorStop(1.0,  `rgba(0, 0, 0, 0)`);

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  textureCache.set(color, texture);
  return texture;
}

// ==========================================
// 3Dシーン初期化
// ==========================================

function init3D() {
  webglCanvas = document.getElementById('webglCanvas') as HTMLCanvasElement;
  overlayCanvas = document.getElementById('overlayCanvas') as HTMLCanvasElement;
  ctx2d = overlayCanvas.getContext('2d')!;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(baseFov, 1, 0.1, 2000);
  camera.position.set(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ canvas: webglCanvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  // 地面 (地平線下を隠す)
  const groundGeo = new THREE.RingGeometry(0, DOME_RADIUS + 5, 64);
  const groundMat = new THREE.MeshBasicMaterial({ color: 0x020309, side: THREE.DoubleSide, depthWrite: true });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = Math.PI / 2;
  ground.position.y = -1;
  scene.add(ground);

  // 地平線リング
  const ringGeo = new THREE.RingGeometry(DOME_RADIUS - 1, DOME_RADIUS + 1, 128);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x00bcd4, side: THREE.DoubleSide });
  const horizonRing = new THREE.Mesh(ringGeo, ringMat);
  horizonRing.rotation.x = Math.PI / 2;
  horizonRing.position.y = -0.5;
  scene.add(horizonRing);

  // 星座線オブジェクト
  const constGeo = new THREE.BufferGeometry();
  constGeo.setAttribute('position', new THREE.BufferAttribute(constellationPositions, 3));
  const constMat = new THREE.LineBasicMaterial({
    color: 0x5ba3ff,
    transparent: true,
    opacity: 0.3,
    linewidth: 1
  });
  constellationMesh = new THREE.LineSegments(constGeo, constMat);
  scene.add(constellationMesh);
}

// ==========================================
// データロード (APIから)
// ==========================================

async function loadFromAPI(): Promise<void> {
  // ステータス表示
  const statusEl = document.getElementById('loading-status');
  if (statusEl) statusEl.textContent = 'APIからデータ取得中...';

  try {
    // 星座メタデータを先に取得
    const metaRes = await fetch('http://localhost:8000/api/constellations');
    if (metaRes.ok) {
      const metaData = await metaRes.json();
      constellationMeta = metaData.constellations;
    }

    // 全天データ取得
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

    if (statusEl) statusEl.textContent = `${starsData.length}星 / 惑星${planetsData.length} / DSO${dsoData.length}天体`;
    console.log(`✓ API loaded: ${starsData.length} stars, ${constellationLinesData.length} constellations, ${planetsData.length} planets, ${dsoData.length} DSOs`);

    // 星スプライトを構築
    buildStarSprites();

  } catch (err) {
    console.error('API load failed:', err);
    if (statusEl) statusEl.textContent = 'APIエラー: バックエンドを起動してください';
    showToast('バックエンドAPIに接続できません。`uvicorn main:app` を起動してください。', 'error');
  }
}

function buildStarSprites() {
  // 既存の星を削除
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

    // 等級に応じたサイズ
    let scale = Math.max(1.0, (6.5 - star.mag) * 3.2);
    if (star.mag < 0) scale *= 1.5; // 特に明るい星は大きく
    sprite.scale.set(scale, scale, 1);

    scene.add(sprite);
    starObjects.set(star.id, sprite);
  });

  console.log(`Built ${starObjects.size} star sprites`);
}

// ==========================================
// 光害グラデーションドーム
// ==========================================

/**
 * 地平線付近に半透明のグラデーションを重ねて光害（街明かり・大気の厚み）を表現する。
 * - 地平線スクリーン位置を 8方位でサンプリングし、画面下部の帯全体をカバー
 * - Layer 1: 街明かり（橙〜黄）… 高度 0〜5° 相当
 * - Layer 2: 大気散乱（青白）… 高度 0〜15° 相当
 * - Layer 3: 薄明かり（藍〜紺）… 高度 0〜25° 相当
 */
function drawLightPollution(w: number, h: number, lst: number) {
  // ★太陽の高度を考慮して、昼間（薄明含む）は街明かりをフェードアウト
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

  // 地平線上の8方位をスクリーン座標に変換
  const horizonAzimuths = [0, 45, 90, 135, 180, 225, 270, 315];
  const horizonScreenY: number[] = [];

  for (const az of horizonAzimuths) {
    const pos3d = horizonToCartesian(az, 0.01, DOME_RADIUS);
    const scr = getScreenPosition(pos3d);
    if (scr.visible) horizonScreenY.push(scr.y);
  }

  // ★修正: 地平線が一点も画面内に見えないなら描画しない（視点が上を向いているとき）
  if (horizonScreenY.length === 0) return;

  // 地平線のY座標（スクリーン上で最も下に見える位置）
  const baseY = Math.max(...horizonScreenY);

  // 地平線が画面下端より下（見切れている）なら描画しない
  if (baseY >= h) return;

  // ★フェードアウト: 地平線が画面下80%より下に来たら徐々に透明化
  // こうすることで地平線がギリギリ見えている段階でも自然に消える
  const fadeThreshold = h * 0.80;
  const fadeAlpha = baseY < fadeThreshold
    ? 1.0
    : 1.0 - (baseY - fadeThreshold) / (h - fadeThreshold);

  if (fadeAlpha <= 0.01) return;

  // 高度 20°相当のスクリーン位置（グラデーション高さの基準）
  // visible でない場合は baseY から画面の1/4上を推定
  const pos20 = horizonToCartesian(viewAzimuth, 20, DOME_RADIUS);
  const scr20 = getScreenPosition(pos20);
  const alt20Y = scr20.visible ? scr20.y : baseY - Math.min(gradEstimate(h), baseY - 20);

  // グラデーションの高さ（最低80px確保）
  const gradHeight = Math.max(80, baseY - alt20Y);

  // 全レイヤーに fadeAlpha と sunFade を乗算して自然なフェードを実現
  ctx2d.save();
  ctx2d.globalAlpha = fadeAlpha * sunFade;

  // ─── 統合グラデーション: 地平線（最明）→ 天頂方向（透明）
  // colorStop 0.0 = baseY（地平線、最も明るい）
  // colorStop 1.0 = baseY - gradHeight（天頂方向、透明）
  // こうすることで「下ほど明るく、上に行くほど暗く消える」が保証される
  {
    const grad = ctx2d.createLinearGradient(0, baseY, 0, baseY - gradHeight);
    // 地平線直上: 街明かり（LED光）の散乱による、ほんのり白み・青みがかった明るい夜空
    grad.addColorStop(0.00, 'rgba(180, 200, 230, 0.28)');
    // 少し上: 白い明かりから夜空の青へとスムーズに遷移
    grad.addColorStop(0.15, 'rgba(130, 160, 195, 0.18)');
    // 中間: 夜空の深い青へ
    grad.addColorStop(0.35, 'rgba( 80, 110, 160, 0.12)');
    // さらに上: 藍色の薄明かり
    grad.addColorStop(0.60, 'rgba( 40,  60, 120, 0.06)');
    // 上端: ほぼ透明
    grad.addColorStop(0.85, 'rgba( 15,  25,  70, 0.02)');
    grad.addColorStop(1.00, 'rgba(  5,  10,  40, 0.00)');
    ctx2d.fillStyle = grad;
    // 地平線から下（地面）も含めて塗る（地面エリアは colorStop 0.0 でクランプ）
    ctx2d.fillRect(0, baseY - gradHeight, w, gradHeight + (h - baseY) + 10);
  }

  // ─── 都市ハロー: 地平線中央に広がる淡い青白の街明かり（ラジアル）
  // ハローは地平線付近のみ（gradHeight の半分以内）に限定し、上には広げない
  {
    const cx = w * 0.5;
    const cy = baseY + 20;
    const rx = w * 0.55;
    const ry = gradHeight * 0.40; // 高さをコンパクトに

    ctx2d.save();
    ctx2d.scale(1.0, ry / rx);
    const haloGrad = ctx2d.createRadialGradient(
      cx, cy * (rx / ry), 0,
      cx, cy * (rx / ry), rx
    );
    // 都市ハローも橙ではなく、LED照明をイメージした淡い青白へ変更
    haloGrad.addColorStop(0.0,  'rgba(215, 230, 255, 0.10)'); // 中心: 淡い青白
    haloGrad.addColorStop(0.35, 'rgba(170, 195, 235, 0.05)');
    haloGrad.addColorStop(0.70, 'rgba(120, 150, 200, 0.02)');
    haloGrad.addColorStop(1.0,  'rgba(80,  110, 160, 0.00)');
    ctx2d.fillStyle = haloGrad;
    ctx2d.fillRect(0, (cy - ry) * (rx / ry), w, ry * 2.5 * (rx / ry));
    ctx2d.restore();
  }

  ctx2d.restore();
}

// gradHeight 推定用ヘルパー（alt20Y が画面外の場合のフォールバック計算）
function gradEstimate(h: number): number {
  // FOVから高度20°相当の画面ピクセル数を推定
  if (!camera) return h * 0.25;
  const pixPerDeg = h / camera.fov;
  return pixPerDeg * 20;
}

// ==========================================
// レンダリングループ
// ==========================================

function updatePositionsAndRender() {
  if (!scene || starsData.length === 0) return;

  const w = overlayCanvas.width;
  const h = overlayCanvas.height;

  // クライアントサイドで星間計算
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

  // 1. 各星の3D位置更新 (クライアントサイド星間計算)
  const now = Date.now();
  starsData.forEach((star) => {
    const hor = equatorialToHorizontal(star.ra, star.dec, lst, latitude);
    const pos3d = horizonToCartesian(hor.az, hor.alt, DOME_RADIUS);

    const sprite = starObjects.get(star.id);
    if (sprite) {
      sprite.position.copy(pos3d);
      sprite.visible = hor.alt >= 0;

      // 瞬き効果
      const twinkle = 0.85 + 0.15 * Math.sin(now * 0.003 + star.id * 17.3);
      let size = Math.max(1.0, (6.5 - star.mag) * 3.2) * twinkle;
      if (star.mag < 0) size *= 1.5;
      sprite.scale.set(size, size, 1);
    }
  });

  // 2. 星座線の更新 (APIからの地平座標を使用)
  if (showConstellations && constellationLinesData.length > 0) {
    let idx = 0;
    constellationLinesData.forEach((constData) => {
      constData.segments.forEach((seg) => {
        if (idx + 6 > constellationPositions.length) return;

        // 地平線より下にあるセグメントは描画しない
        if (seg.alt1 < 0 || seg.alt2 < 0) return;

        // セグメントの両端を3D座標に変換
        // APIは毎フレームの計算ではなく初回のAlt/Azを返すので、
        // クライアントサイドで再計算する（高速化のためRA/Decから）
        // ここではAPIから返された az/alt を使う (ほぼリアルタイム十分)
        const p1 = horizonToCartesian(seg.az1, seg.alt1, DOME_RADIUS - 1);
        const p2 = horizonToCartesian(seg.az2, seg.alt2, DOME_RADIUS - 1);

        constellationPositions[idx++] = p1.x;
        constellationPositions[idx++] = p1.y;
        constellationPositions[idx++] = p1.z;
        constellationPositions[idx++] = p2.x;
        constellationPositions[idx++] = p2.y;
        constellationPositions[idx++] = p2.z;
      });
    });
    constellationMesh.geometry.setDrawRange(0, idx / 3);
    constellationMesh.geometry.attributes.position.needsUpdate = true;
    constellationMesh.visible = true;
  } else {
    constellationMesh.visible = false;
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

  // 4. 3Dレンダリング
  renderer.render(scene, camera);

  // 5. 2Dオーバーレイ描画
  ctx2d.clearRect(0, 0, w, h);

  // 光害グラデーションドーム (地平線付近の大気・街明かり表現)
  drawLightPollution(w, h, lst);

  // 明るい星の名前を表示 (API呼び出し時に取得したデータに名前がないため、HIP番号から判定)
  if (showStarNames) {
    ctx2d.font = "11px 'Outfit', sans-serif";
    ctx2d.textBaseline = "middle";

    starsData.forEach((star) => {
      if (star.mag > 2.2) return; // 2等星以上のみ名前表示

      const hor = equatorialToHorizontal(star.ra, star.dec, lst, latitude);
      if (hor.alt < 0) return;

      const pos3d = horizonToCartesian(hor.az, hor.alt, DOME_RADIUS);
      const scr = getScreenPosition(pos3d);
      if (!scr.visible) return;

      const starName = BRIGHT_STAR_NAMES[star.id];
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

  // 6. 惑星描画
  if (showPlanets && planetsData.length > 0) {
    drawPlanets(lst);
  }

  // 7. DSO描画
  if (showDSO && dsoData.length > 0) {
    drawDSO();
  }
}

// HIP番号 → 星の日本語名 (主要な明るい星のみ)
const BRIGHT_STAR_NAMES: Record<number, string> = {
  32349: 'シリウス', 30438: 'カノープス', 69673: 'アークトゥルス',
  91262: 'ベガ', 24608: 'カペラ', 24436: 'リゲル',
  37279: 'プロキオン', 27989: 'ベテルギウス', 97649: 'アルタイル',
  21421: 'アルデバラン', 80763: 'アンタレス', 65474: 'スピカ',
  37826: 'ポルックス', 102098: 'デネブ', 113368: 'フォーマルハウト',
  49669: 'レグルス', 36850: 'カストル', 11767: 'ポラリス',
  25336: 'ミルファク', 68702: 'ミザール', 62956: 'アリオト',
  54061: 'ドゥーベ', 67301: 'アルカイド', 28380: 'ベラトリックス',
  27366: 'サイフ', 26727: 'アルニタク', 26311: 'アルニラム',
  25930: 'ミンタカ', 9884: 'アケルナル',
};

// ==========================================
// 惑星描画
// ==========================================

function drawPlanets(lst: number) {
  planetsData.forEach((planet) => {
    // リアルタイムでクライアント側の地平座標を再計算
    const hor = equatorialToHorizontal(planet.ra, planet.dec, lst, latitude);
    if (hor.alt < 0) return; // 地平線下は描画しない

    const pos3d = horizonToCartesian(hor.az, hor.alt, DOME_RADIUS);
    const scr = getScreenPosition(pos3d);
    if (!scr.visible) return;

    // 惑星のサイズ（等級に応じて）
    const baseSize = Math.max(6, (1.0 - planet.mag) * 4 + 10);

    // 色をパース
    const r = parseInt(planet.color.slice(1, 3), 16);
    const g = parseInt(planet.color.slice(3, 5), 16);
    const b = parseInt(planet.color.slice(5, 7), 16);

    // 光芒グラデーション（大きめのハロー）
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

    // 惑星本体（円）
    const diskGrad = ctx2d.createRadialGradient(scr.x - baseSize * 0.2, scr.y - baseSize * 0.2, 0, scr.x, scr.y, baseSize);
    diskGrad.addColorStop(0, `rgba(255, 255, 255, 1.0)`);
    diskGrad.addColorStop(0.4, `rgba(${r}, ${g}, ${b}, 1.0)`);
    diskGrad.addColorStop(1.0, `rgba(${Math.floor(r*0.6)}, ${Math.floor(g*0.6)}, ${Math.floor(b*0.6)}, 0.8)`);
    ctx2d.beginPath();
    ctx2d.arc(scr.x, scr.y, baseSize, 0, Math.PI * 2);
    ctx2d.fillStyle = diskGrad;
    ctx2d.fill();

    // 名前ラベル
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
    if (obj.alt < 0) return; // 地平線下は描画しない

    const pos3d = horizonToCartesian(obj.az, obj.alt, DOME_RADIUS);
    const scr = getScreenPosition(pos3d);
    if (!scr.visible) return;

    // 視直径をスクリーン半径に変換
    // FOVとcanvasサイズから 1分角あたりのピクセル数を計算
    const fovDeg = camera.fov;
    const pixPerDeg = overlayCanvas.height / fovDeg;
    const pixPerArcmin = pixPerDeg / 60.0;
    const screenRadius = Math.max(5, (obj.size / 2) * pixPerArcmin);

    ctx2d.save();
    ctx2d.textAlign = 'left';
    ctx2d.textBaseline = 'middle';

    if (obj.type === 'galaxy') {
      // 銀河: 傾いた楕円 + グラデーション
      const rx = screenRadius;
      const ry = screenRadius * 0.45;
      const angle = Math.PI / 5; // 約36度傾き

      // 内側グラデーション
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

      // 楕円アウトライン（点線）
      ctx2d.setLineDash([3, 4]);
      ctx2d.strokeStyle = 'rgba(255, 220, 130, 0.6)';
      ctx2d.lineWidth = 1;
      ctx2d.stroke();
      ctx2d.setLineDash([]);
      ctx2d.restore();

      // 名前ラベル（restore後）
      ctx2d.textAlign = 'left';
      ctx2d.textBaseline = 'middle';
      ctx2d.font = `10px 'Outfit', sans-serif`;
      ctx2d.fillStyle = 'rgba(255, 220, 130, 0.85)';
      ctx2d.fillText(`${obj.id} ${obj.name_ja}`, scr.x + screenRadius + 4, scr.y);

    } else if (obj.type === 'nebula' || obj.type === 'supernova_remnant') {
      // 星雲: 点線の丸 + 中心グラデーション
      const grd = ctx2d.createRadialGradient(scr.x, scr.y, 0, scr.x, scr.y, screenRadius);
      grd.addColorStop(0,   'rgba(100, 200, 255, 0.2)');
      grd.addColorStop(0.6, 'rgba(80, 160, 255, 0.08)');
      grd.addColorStop(1,   'rgba(60, 120, 220, 0)');

      ctx2d.beginPath();
      ctx2d.arc(scr.x, scr.y, screenRadius, 0, Math.PI * 2);
      ctx2d.fillStyle = grd;
      ctx2d.fill();

      // 点線丸アウトライン
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
      // 星団 (cluster / open_cluster): 点線の丸（破線間隔違い）
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

  // 惑星・DSOトグル
  const planetsCheckbox = document.getElementById('toggle-planets') as HTMLInputElement;
  const dsoCheckbox = document.getElementById('toggle-dso') as HTMLInputElement;
  if (planetsCheckbox) planetsCheckbox.addEventListener('change', () => { showPlanets = planetsCheckbox.checked; });
  if (dsoCheckbox) dsoCheckbox.addEventListener('change', () => { showDSO = dsoCheckbox.checked; });

  // 星座選択ドロップダウン
  const constSelect = document.getElementById('constellation-select') as HTMLSelectElement;
  constSelect.addEventListener('change', () => {
    const cid = constSelect.value;
    if (cid) showConstellationInfo(cid);
    else hideConstellationInfo();
  });

  // 情報パネルを閉じる
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
    camera.fov = Math.max(10.0, Math.min(75.0, camera.fov * (e.deltaY < 0 ? (1/1.08) : 1.08)));
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
    planetsDsoLastUpdate = Date.now();
  } catch (_) {
    // サイレントに失敗（描画は前回データで継続）
  }
}

function tick() {
  updateTime();

  // 惑星・DSOを30秒ごとにAPIから更新
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
  init3D();
  initEvents();
  await loadFromAPI();
  if (Object.keys(constellationMeta).length > 0) {
    populateConstellationSelect();
  }
  showToast(`Stellaris 起動完了 - ${starsData.length}星 / 88星座 / 惑星${planetsData.length}`, 'info');
  tick();
}

window.addEventListener('DOMContentLoaded', start);
