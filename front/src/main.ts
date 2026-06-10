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
let showAsterisms = false;
let showStarNames = true;

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

    if (statusEl) statusEl.textContent = `${starsData.length}星ロード完了`;
    console.log(`✓ API loaded: ${starsData.length} stars, ${constellationLinesData.length} constellations`);

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

  // 明るい星の名前を表示 (API呼び出し時に取得したデータに名前がないため、HIP番号から判定)
  if (showStarNames) {
    ctx2d.font = "11px 'Outfit', sans-serif";
    ctx2d.textBaseline = "middle";

    starsData.forEach((star) => {
      if (star.mag > 2.2) return; // 2等星以上のみ名前表示

      const hor = equatorialToHorizontal(star.ra, star.dec, lst, latitude);
      if (hor.alt < -5) return;

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

function tick() {
  updateTime();
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
  showToast(`Stellaris 起動完了 - ${starsData.length}星 / 88星座`, 'info');
  tick();
}

window.addEventListener('DOMContentLoaded', start);
