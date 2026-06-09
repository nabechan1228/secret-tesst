import * as THREE from 'three';

interface Star {
  id: number;
  name_en: string;
  name_ja: string;
  ra: number;  // 赤経 (Hours)
  dec: number; // 赤緯 (Degrees)
  mag: number; // 等級 (Magnitude)
}

interface ConstellationLine {
  from: number;
  to: number;
  constellation: string;
}

interface AsterismLine {
  from: number;
  to: number;
  label: string;
}

// 恒星・星座データ
let starCatalog: Star[] = [];
let constellationLines: ConstellationLine[] = [];
let asterismLines: AsterismLine[] = [];

// 観測地設定 (デフォルト: 東京)
let latitude = 35.68;
let longitude = 139.76;

// 時間設定
let currentDate = new Date();
let isTimeFlowing = true;
let timeSpeed = 1; // 時間加速倍率

// 視野設定
let viewAzimuth = 180;   // カメラの中心方位角 (度, 180: 南を向く)
let viewAltitude = 45;   // カメラの仰角 (度, 45度見上げる)
let baseFov = 60;        // カメラの基準視野角 (ズームで可変)

// 描画設定
let showConstellations = true;
let showAsterisms = true;
let showStarNames = true;

// マウスインタラクション
let isDragging = false;
let startMouseX = 0;
let startMouseY = 0;
let startAzimuth = 180;
let startAltitude = 45;

// WebGL (Three.js) & 2D Overlay 関連
let webglCanvas: HTMLCanvasElement;
let overlayCanvas: HTMLCanvasElement;
let ctx2d: CanvasRenderingContext2D;

let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGLRenderer;

// 3D空間オブジェクトへのポインタ
const starObjects: { [id: number]: THREE.Sprite } = {};
const starDataMap: { [id: number]: Star } = {};
let constellationMesh: THREE.LineSegments;
let asterismMesh: THREE.LineSegments;

const constellationPositions = new Float32Array(500 * 3); // 結線用バッファ
const asterismPositions = new Float32Array(100 * 3);

const DOME_RADIUS = 500; // 天球の半径

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
  if (m <= 2) {
    year -= 1;
    m += 12;
  }
  
  const a = Math.floor(year / 100);
  const b = 2 - a + Math.floor(a / 4);
  
  return Math.floor(365.25 * (year + 4716)) + Math.floor(30.6001 * (m + 1)) + d + b - 1524.5;
}

function getLocalSiderealTime(jd: number, lng: number): number {
  const t = (jd - 2451545.0) / 36525.0;
  let gmst = 280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * t * t - (t * t * t) / 38710000.0;
  gmst = gmst % 360.0;
  if (gmst < 0) gmst += 360.0;
  
  let lst = gmst + lng;
  lst = lst % 360.0;
  if (lst < 0) lst += 360.0;
  return lst;
}

interface HorizonCoord {
  az: number;
  alt: number;
}

function equatorialToHorizontal(ra: number, dec: number, lstDeg: number, latDeg: number): HorizonCoord {
  const haDeg = lstDeg - (ra * 15.0);
  
  const ha = haDeg * Math.PI / 180.0;
  const decRad = dec * Math.PI / 180.0;
  const lat = latDeg * Math.PI / 180.0;
  
  // 高度 (alt)
  let sinAlt = Math.sin(lat) * Math.sin(decRad) + Math.cos(lat) * Math.cos(decRad) * Math.cos(ha);
  sinAlt = Math.max(-1.0, Math.min(1.0, sinAlt));
  const alt = Math.asin(sinAlt);
  
  // 方位角 (az) - 北=0, 東=90
  const y = -Math.sin(ha) * Math.cos(decRad);
  const x = Math.cos(lat) * Math.sin(decRad) - Math.sin(lat) * Math.cos(decRad) * Math.cos(ha);
  let az = Math.atan2(y, x);
  if (az < 0) az += 2 * Math.PI;
  
  return {
    az: az * 180.0 / Math.PI,
    alt: alt * 180.0 / Math.PI
  };
}

// 地平座標 (Az, Alt) から 3D直交座標 (X, Y, Z) に変換
// Y軸が天頂方向, Z軸が北方向, X軸が東方向とする
function horizonToCartesian(azDeg: number, altDeg: number, radius: number): THREE.Vector3 {
  const az = azDeg * Math.PI / 180.0;
  const alt = altDeg * Math.PI / 180.0;
  
  // X: 東, Y: 天頂, Z: 北 (Zのマイナスが真北になるように計算)
  const x = radius * Math.cos(alt) * Math.sin(az);
  const y = radius * Math.sin(alt);
  const z = -radius * Math.cos(alt) * Math.cos(az);
  
  return new THREE.Vector3(x, y, z);
}

// 3D座標を2Dスクリーン座標に投影する関数 (星名描画用)
const tempV = new THREE.Vector3();
function getScreenPosition(pos3d: THREE.Vector3): { x: number; y: number; visible: boolean } {
  tempV.copy(pos3d);
  tempV.project(camera); // NDC座標 (-1 から 1) に変換
  
  // カメラの背後にある場合、または視野外は非表示にする
  if (tempV.z > 1 || Math.abs(tempV.x) > 1 || Math.abs(tempV.y) > 1) {
    return { x: 0, y: 0, visible: false };
  }
  
  const x = (tempV.x * 0.5 + 0.5) * overlayCanvas.width;
  const y = (tempV.y * -0.5 + 0.5) * overlayCanvas.height;
  
  return { x, y, visible: true };
}

// ==========================================
// 3Dオブジェクトテクスチャ作成
// ==========================================

// 星の輝き用の円形グラデーションテクスチャを Canvas から動的に生成
function createStarTexture(isGiant: boolean): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  if (isGiant) {
    // 赤色巨星用 (ベテルギウスなど)
    grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
    grad.addColorStop(0.15, 'rgba(255, 230, 200, 1.0)');
    grad.addColorStop(0.35, 'rgba(255, 120, 60, 0.7)');
    grad.addColorStop(0.7, 'rgba(255, 60, 20, 0.15)');
    grad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
  } else {
    // 通常・青白い恒星用
    grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
    grad.addColorStop(0.15, 'rgba(230, 245, 255, 1.0)');
    grad.addColorStop(0.35, 'rgba(100, 180, 255, 0.6)');
    grad.addColorStop(0.7, 'rgba(50, 120, 255, 0.15)');
    grad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
  }
  
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// ==========================================
// 3Dシーン初期化 (Three.js Setup)
// ==========================================

function init3D() {
  webglCanvas = document.getElementById('webglCanvas') as HTMLCanvasElement;
  overlayCanvas = document.getElementById('overlayCanvas') as HTMLCanvasElement;
  ctx2d = overlayCanvas.getContext('2d')!;

  // 1. Scene の作成
  scene = new THREE.Scene();

  // 2. Camera の作成 (PerspectiveCamera で視野角 fov によるズームに対応)
  camera = new THREE.PerspectiveCamera(baseFov, 1, 0.1, 2000);
  camera.position.set(0, 0, 0); // 観測者は原点に位置する

  // 3. Renderer の作成
  renderer = new THREE.WebGLRenderer({ canvas: webglCanvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  // 4. 地平線（地面の遮蔽ディスク）を追加
  // 天球の半径より少し外側 (R=502) にディスクを配置し、地平線下の星が隠れるようにする
  const groundGeo = new THREE.RingGeometry(0, DOME_RADIUS + 5, 64);
  const groundMat = new THREE.MeshBasicMaterial({
    color: 0x020309,
    side: THREE.DoubleSide,
    depthWrite: true
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = Math.PI / 2; // 水平にする
  ground.position.y = -1; // カメラの足元わずか下に配置
  scene.add(ground);

  // 5. 地平線の円環（境界線）を追加
  const ringGeo = new THREE.RingGeometry(DOME_RADIUS - 1, DOME_RADIUS + 1, 64);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x00bcd4,
    side: THREE.DoubleSide
  });
  const horizonRing = new THREE.Mesh(ringGeo, ringMat);
  horizonRing.rotation.x = Math.PI / 2;
  horizonRing.position.y = -0.5;
  scene.add(horizonRing);

  // 6. 星座線オブジェクトの作成 (バッファ更新型)
  const constGeo = new THREE.BufferGeometry();
  constGeo.setAttribute('position', new THREE.BufferAttribute(constellationPositions, 3));
  const constMat = new THREE.LineBasicMaterial({
    color: 0x468cff,
    transparent: true,
    opacity: 0.28,
    linewidth: 1
  });
  constellationMesh = new THREE.LineSegments(constGeo, constMat);
  scene.add(constellationMesh);

  // 7. アステリズムオブジェクトの作成
  const astGeo = new THREE.BufferGeometry();
  astGeo.setAttribute('position', new THREE.BufferAttribute(asterismPositions, 3));
  const astMat = new THREE.LineBasicMaterial({
    color: 0xffb432,
    transparent: true,
    opacity: 0.32,
    linewidth: 1
  });
  asterismMesh = new THREE.LineSegments(astGeo, astMat);
  scene.add(asterismMesh);
}

// API からデータを読み込む
// API からデータを読み込む
async function loadStarCatalog() {
  const originalCatalog: Star[] = [
    {id: 1, name_en: "Sirius", name_ja: "シリウス", ra: 6.75, dec: -16.72, mag: -1.46},
    {id: 2, name_en: "Canopus", name_ja: "カノープス", ra: 6.4, dec: -52.7, mag: -0.74},
    {id: 3, name_en: "Arcturus", name_ja: "アークトゥルス", ra: 14.26, dec: 19.18, mag: -0.05},
    {id: 4, name_en: "Vega", name_ja: "ベガ", ra: 18.62, dec: 38.78, mag: 0.03},
    {id: 5, name_en: "Capella", name_ja: "カペラ", ra: 5.28, dec: 46.0, mag: 0.08},
    {id: 6, name_en: "Rigel", name_ja: "リゲル", ra: 5.24, dec: -8.2, mag: 0.13},
    {id: 7, name_en: "Procyon", name_ja: "プロキオン", ra: 7.66, dec: 5.22, mag: 0.34},
    {id: 8, name_en: "Betelgeuse", name_ja: "ベテルギウス", ra: 5.92, dec: 7.41, mag: 0.42},
    {id: 9, name_en: "Altair", name_ja: "アルタイル", ra: 19.85, dec: 8.87, mag: 0.76},
    {id: 10, name_en: "Aldebaran", name_ja: "アルデバラン", ra: 4.6, dec: 16.51, mag: 0.85},
    {id: 11, name_en: "Antares", name_ja: "アンタレス", ra: 16.49, dec: -26.43, mag: 1.06},
    {id: 12, name_en: "Spica", name_ja: "スピカ", ra: 13.42, dec: -11.16, mag: 0.98},
    {id: 13, name_en: "Pollux", name_ja: "ポルックス", ra: 7.75, dec: 28.02, mag: 1.14},
    {id: 14, name_en: "Deneb", name_ja: "デネブ", ra: 20.69, dec: 45.28, mag: 1.25},
    {id: 15, name_en: "Fomalhaut", name_ja: "フォーマルハウト", ra: 22.96, dec: -29.62, mag: 1.16},
    {id: 16, name_en: "Regulus", name_ja: "レグルス", ra: 10.14, dec: 11.96, mag: 1.36},
    {id: 17, name_en: "Castor", name_ja: "カストル", ra: 7.58, dec: 31.89, mag: 1.58},
    {id: 18, name_en: "Polaris", name_ja: "ポラリス", ra: 2.53, dec: 89.26, mag: 1.97},
    {id: 21, name_en: "Bellatrix", name_ja: "ベラトリックス", ra: 5.42, dec: 6.35, mag: 1.64},
    {id: 22, name_en: "Saiph", name_ja: "サイフ", ra: 5.79, dec: -9.67, mag: 2.06},
    {id: 23, name_en: "Alnitak", name_ja: "アルニタク", ra: 5.68, dec: -1.94, mag: 1.74},
    {id: 24, name_en: "Alnilam", name_ja: "アルニラム", ra: 5.6, dec: -1.2, mag: 1.69},
    {id: 25, name_en: "Mintaka", name_ja: "ミンタカ", ra: 5.53, dec: -0.3, mag: 2.23},
    {id: 31, name_en: "Dubhe", name_ja: "ドゥーベ", ra: 11.06, dec: 61.75, mag: 1.79},
    {id: 32, name_en: "Merak", name_ja: "メラク", ra: 11.03, dec: 56.38, mag: 2.34},
    {id: 33, name_en: "Phecda", name_ja: "フェクダ", ra: 11.89, dec: 53.69, mag: 2.41},
    {id: 34, name_en: "Megrez", name_ja: "メグレス", ra: 12.25, dec: 57.03, mag: 3.32},
    {id: 35, name_en: "Alioth", name_ja: "アリオト", ra: 12.9, dec: 55.96, mag: 1.76},
    {id: 36, name_en: "Mizar", name_ja: "ミザール", ra: 13.4, dec: 54.92, mag: 2.23},
    {id: 37, name_en: "Alkaid", name_ja: "アルカイド", ra: 13.79, dec: 49.31, mag: 1.85},
    {id: 41, name_en: "Shedar", name_ja: "シェダル", ra: 0.68, dec: 56.54, mag: 2.24},
    {id: 42, name_en: "Caph", name_ja: "カフ", ra: 0.15, dec: 59.15, mag: 2.28},
    {id: 43, name_en: "Tsih", name_ja: "ツィー", ra: 0.95, dec: 60.72, mag: 2.15},
    {id: 44, name_en: "Ruchbah", name_ja: "ルクバー", ra: 1.43, dec: 60.23, mag: 2.66},
    {id: 45, name_en: "Segin", name_ja: "セギン", ra: 1.9, dec: 63.67, mag: 3.35},
    {id: 51, name_en: "Sadr", name_ja: "サドル", ra: 20.37, dec: 40.26, mag: 2.23},
    {id: 52, name_en: "Albireo", name_ja: "アルビレオ", ra: 19.51, dec: 27.96, mag: 3.05},
    {id: 53, name_en: "Gienah", name_ja: "ジェナー", ra: 20.77, dec: 33.97, mag: 2.48},
    {id: 54, name_en: "Fawaris", name_ja: "ファワリス", ra: 19.61, dec: 45.13, mag: 2.87},
    {id: 61, name_en: "Sulafat", name_ja: "スラファト", ra: 18.98, dec: 32.68, mag: 3.24},
    {id: 62, name_en: "Sheliak", name_ja: "シェリアク", ra: 18.83, dec: 33.36, mag: 3.52},
    {id: 63, name_en: "Aladfar", name_ja: "アラドファ", ra: 18.74, dec: 37.6, mag: 4.3},
    {id: 71, name_en: "Alshain", name_ja: "アルシャイン", ra: 19.92, dec: 6.4, "mag": 3.71},
    {id: 72, name_en: "Tarazed", name_ja: "タラゼド", ra: 19.77, dec: 10.61, "mag": 2.72},
    {id: 81, name_en: "Acrux", name_ja: "アクルックス", ra: 12.44, dec: -63.1, mag: 0.77},
    {id: 82, name_en: "Mimosa", name_ja: "ミモザ", ra: 12.79, dec: -59.68, mag: 1.25},
    {id: 83, name_en: "Gacrux", name_ja: "ガクルックス", ra: 12.52, dec: -57.11, mag: 1.59},
    {id: 84, name_en: "Imai", name_ja: "イマイ", ra: 12.25, dec: -58.75, mag: 2.79}
  ];

  const defaultConstellationLines: ConstellationLine[] = [
    { from: 8, to: 21, constellation: "Orion" },
    { from: 21, to: 25, constellation: "Orion" },
    { from: 25, to: 24, constellation: "Orion" },
    { from: 24, to: 23, constellation: "Orion" },
    { from: 23, to: 8, constellation: "Orion" },
    { from: 23, to: 6, constellation: "Orion" },
    { from: 6, to: 22, constellation: "Orion" },
    { from: 22, to: 25, constellation: "Orion" },
    { from: 31, to: 32, constellation: "Ursa Major" },
    { from: 32, to: 33, constellation: "Ursa Major" },
    { from: 33, to: 34, constellation: "Ursa Major" },
    { from: 34, to: 31, constellation: "Ursa Major" },
    { from: 34, to: 35, constellation: "Ursa Major" },
    { from: 35, to: 36, constellation: "Ursa Major" },
    { from: 36, to: 37, constellation: "Ursa Major" },
    { from: 42, to: 41, constellation: "Cassiopeia" },
    { from: 41, to: 43, constellation: "Cassiopeia" },
    { from: 43, to: 44, constellation: "Cassiopeia" },
    { from: 44, to: 45, constellation: "Cassiopeia" },
    { from: 14, to: 51, constellation: "Cygnus" },
    { from: 51, to: 52, constellation: "Cygnus" },
    { from: 51, to: 53, constellation: "Cygnus" },
    { from: 51, to: 54, constellation: "Cygnus" },
    { from: 4, to: 63, constellation: "Lyra" },
    { from: 4, to: 62, constellation: "Lyra" },
    { from: 62, to: 61, constellation: "Lyra" },
    { from: 61, to: 4, constellation: "Lyra" },
    { from: 9, to: 71, constellation: "Aquila" },
    { from: 9, to: 72, constellation: "Aquila" },
    { from: 81, to: 83, constellation: "Crux" },
    { from: 82, to: 84, constellation: "Crux" }
  ];

  const defaultAsterismLines: AsterismLine[] = [
    { from: 4, to: 14, label: "Summer Triangle" },
    { from: 14, to: 9, label: "Summer Triangle" },
    { from: 9, to: 4, label: "Summer Triangle" }
  ];

  try {
    // バックエンドから星カタログと線を一発取得
    const response = await fetch(`http://localhost:8000/api/sky?lat=${latitude}&lng=${longitude}`);
    if (!response.ok) throw new Error('API server down');
    const data = await response.json();

    constellationLines = data.constellations;
    asterismLines = data.asterisms;
    starCatalog = data.stars;
    console.log("3D Catalog loaded successfully from API:", starCatalog.length, "stars.");
  } catch (error) {
    console.warn("Failed loading catalog from API. Falling back to local catalog.", error);
    // フォールバックデータの設定
    constellationLines = defaultConstellationLines;
    asterismLines = defaultAsterismLines;
    starCatalog = originalCatalog;
  }

  // テクスチャをあらかじめ作成
  const textureNormal = createStarTexture(false);
  const textureGiant = createStarTexture(true);

  // 星の3Dスプライトオブジェクトの構築
  starCatalog.forEach((star) => {
    starDataMap[star.id] = star;

    const isGiant = (star.id === 8 || star.id === 11); // ベテルギウスかアンタレスか
    const material = new THREE.SpriteMaterial({
      map: isGiant ? textureGiant : textureNormal,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const sprite = new THREE.Sprite(material);
    
    // 等級に応じた星の見た目の初期サイズ
    let scale = (5.0 - star.mag) * 2.6;
    if (scale < 1.0) scale = 1.0;
    sprite.scale.set(scale, scale, 1);
    
    scene.add(sprite);
    starObjects[star.id] = sprite;
  });

  console.log("3D Catalog initialized with", starCatalog.length, "stars.");
}

// ==========================================
// レンダリング＆計算ループ
// ==========================================

function updatePositionsAndRender() {
  if (!scene || starCatalog.length === 0) return;

  const w = overlayCanvas.width;
  const h = overlayCanvas.height;

  // 現時点のユリウス日と地方恒星時を計算
  const jd = getJulianDate(currentDate);
  const lst = getLocalSiderealTime(jd, longitude);

  // ダッシュボードへの反映
  document.getElementById('stat-jd')!.textContent = jd.toFixed(5);
  const lstHrs = lst / 15.0;
  const lstH = Math.floor(lstHrs);
  const lstM = Math.floor((lstHrs - lstH) * 60);
  const lstS = Math.floor(((lstHrs - lstH) * 60 - lstM) * 60);
  document.getElementById('stat-lst')!.textContent = 
    `${String(lstH).padStart(2, '0')}h ${String(lstM).padStart(2, '0')}m ${String(lstS).padStart(2, '0')}s (${lst.toFixed(1)}°)`;
  document.getElementById('stat-view')!.textContent = 
    `${viewAzimuth.toFixed(0)}° / ${viewAltitude.toFixed(0)}°`;
  document.getElementById('stat-zoom')!.textContent = 
    `${Math.round((60.0 / camera.fov) * 100)}%`;

  // 1. 各星の3D位置を天体計算に基づいて更新
  const current3DPositions: { [id: number]: THREE.Vector3 } = {};

  starCatalog.forEach((star) => {
    // 地平座標 (Alt/Az) を算出
    const hor = equatorialToHorizontal(star.ra, star.dec, lst, latitude);
    
    // 3D直交座標系 (X, Y, Z) にマッピング
    const pos3d = horizonToCartesian(hor.az, hor.alt, DOME_RADIUS);
    current3DPositions[star.id] = pos3d;

    // Three.js のスプライト位置を更新
    const sprite = starObjects[star.id];
    if (sprite) {
      sprite.position.copy(pos3d);
      
      // 等級に応じた瞬き効果の適用 (ランダム要素にサイン波を組み合わせ)
      const twinkle = 0.82 + 0.18 * Math.sin(Date.now() * 0.005 + star.id * 23);
      let size = (5.0 - star.mag) * 2.6 * twinkle;
      if (size < 1.0) size = 1.0;
      sprite.scale.set(size, size, 1);
    }
  });

  // 2. 星座線 (Constellation Lines) の頂点更新
  if (showConstellations) {
    let idx = 0;
    constellationLines.forEach((line) => {
      const pFrom = current3DPositions[line.from];
      const pTo = current3DPositions[line.to];
      
      if (pFrom && pTo && idx + 6 <= constellationPositions.length) {
        constellationPositions[idx++] = pFrom.x;
        constellationPositions[idx++] = pFrom.y;
        constellationPositions[idx++] = pFrom.z;
        constellationPositions[idx++] = pTo.x;
        constellationPositions[idx++] = pTo.y;
        constellationPositions[idx++] = pTo.z;
      }
    });
    constellationMesh.geometry.setDrawRange(0, idx / 3);
    constellationMesh.geometry.attributes.position.needsUpdate = true;
    constellationMesh.visible = true;
  } else {
    constellationMesh.visible = false;
  }

  // 3. アステリズム (Asterisms) の頂点更新
  if (showAsterisms) {
    let idx = 0;
    asterismLines.forEach((line) => {
      const pFrom = current3DPositions[line.from];
      const pTo = current3DPositions[line.to];
      
      if (pFrom && pTo && idx + 6 <= asterismPositions.length) {
        asterismPositions[idx++] = pFrom.x;
        asterismPositions[idx++] = pFrom.y;
        asterismPositions[idx++] = pFrom.z;
        asterismPositions[idx++] = pTo.x;
        asterismPositions[idx++] = pTo.y;
        asterismPositions[idx++] = pTo.z;
      }
    });
    asterismMesh.geometry.setDrawRange(0, idx / 3);
    asterismMesh.geometry.attributes.position.needsUpdate = true;
    asterismMesh.visible = true;
  } else {
    asterismMesh.visible = false;
  }

  // 4. カメラの向きを決定 (方位角と仰角から注視点ターゲットを算出)
  // 真上特異点（ジンバルロック）を防ぐため、viewAltitude は 89.9度以下に制限済み
  const camAzRad = viewAzimuth * Math.PI / 180.0;
  const camAltRad = viewAltitude * Math.PI / 180.0;
  
  // カメラ正面方向 (Z軸のマイナス方向が正面)
  let targetX = Math.cos(camAltRad) * Math.sin(camAzRad);
  let targetY = Math.sin(camAltRad);
  let targetZ = -Math.cos(camAltRad) * Math.cos(camAzRad);
  
  if (isNaN(targetX) || isNaN(targetY) || isNaN(targetZ)) {
    targetX = 0;
    targetY = 1;
    targetZ = -0.1;
  }
  
  camera.lookAt(new THREE.Vector3(targetX, targetY, targetZ));

  // 5. 3D レンダリングの実行
  renderer.render(scene, camera);

  // 6. 2D オーバーレイCanvas（星名、方位ラベルなど）のクリアと描画
  ctx2d.clearRect(0, 0, w, h);

  // 文字描画の設定
  ctx2d.font = "11px 'Outfit', 'Noto Sans JP', sans-serif";
  ctx2d.textBaseline = "middle";

  // 星の名前の描画
  starCatalog.forEach((star) => {
    const pos3d = current3DPositions[star.id];
    if (!pos3d) return;

    // 地平線より下（Y < 0）にある星はテキストを描画しない
    if (pos3d.y < -5) return;

    const scr = getScreenPosition(pos3d);
    if (scr.visible && showStarNames && star.mag <= 2.2) {
      // 星のサイズに応じてテキストの位置をずらす
      const offset = (5.0 - star.mag) * 3 + 8;
      
      // テキスト背景に薄い影を付けて見やすくする
      ctx2d.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx2d.fillText(star.name_ja, scr.x + offset + 1, scr.y + 1);
      
      ctx2d.fillStyle = 'rgba(210, 225, 255, 0.8)';
      ctx2d.fillText(star.name_ja, scr.x + offset, scr.y);
    }
  });

  // 方位ラベル (N, E, S, W) を地平線の位置に重ねて描画
  const directions = [
    { name: "N", az: 0 },
    { name: "E", az: 90 },
    { name: "S", az: 180 },
    { name: "W", az: 270 }
  ];

  ctx2d.font = "bold 13px 'Outfit', sans-serif";
  ctx2d.textAlign = "center";

  directions.forEach((dir) => {
    const pos3d = horizonToCartesian(dir.az, 0, DOME_RADIUS);
    const scr = getScreenPosition(pos3d);
    
    if (scr.visible) {
      ctx2d.fillStyle = 'rgba(0, 0, 0, 0.8)';
      ctx2d.fillText(dir.name, scr.x + 1, scr.y + 1);
      
      ctx2d.fillStyle = 'rgba(0, 188, 212, 0.85)';
      ctx2d.fillText(dir.name, scr.x, scr.y);
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
    switch (presetSelect.value) {
      case 'tokyo':
        latitude = 35.68;
        longitude = 139.76;
        break;
      case 'sydney':
        latitude = -33.86;
        longitude = 151.20;
        break;
      case 'northpole':
        latitude = 90.0;
        longitude = 0.0;
        break;
      case 'equator':
        latitude = 0.0;
        longitude = 0.0;
        break;
    }
    latInput.value = String(latitude);
    lngInput.value = String(longitude);
  });

  latInput.addEventListener('input', () => {
    latitude = parseFloat(latInput.value) || 0;
  });
  lngInput.addEventListener('input', () => {
    longitude = parseFloat(lngInput.value) || 0;
  });

  const timeFlowCheckbox = document.getElementById('toggle-time-flow') as HTMLInputElement;
  const speedSlider = document.getElementById('time-speed') as HTMLInputElement;
  const speedLabel = document.getElementById('speed-label')!;
  const dateInput = document.getElementById('input-date') as HTMLInputElement;

  timeFlowCheckbox.addEventListener('change', () => {
    isTimeFlowing = timeFlowCheckbox.checked;
  });

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
    if (!isNaN(parsed)) {
      currentDate = new Date(parsed);
    }
  });

  const constellationCheckbox = document.getElementById('toggle-constellations') as HTMLInputElement;
  const asterismCheckbox = document.getElementById('toggle-asterisms') as HTMLInputElement;
  const starNamesCheckbox = document.getElementById('toggle-star-names') as HTMLInputElement;

  constellationCheckbox.addEventListener('change', () => {
    showConstellations = constellationCheckbox.checked;
  });
  asterismCheckbox.addEventListener('change', () => {
    showAsterisms = asterismCheckbox.checked;
  });
  starNamesCheckbox.addEventListener('change', () => {
    showStarNames = starNamesCheckbox.checked;
  });

  // 3D用のドラッグカメラ制御 (方位角・仰角を変更)
  webglCanvas.addEventListener('mousedown', (e) => {
    isDragging = true;
    startMouseX = e.clientX;
    startMouseY = e.clientY;
    startAzimuth = viewAzimuth;
    startAltitude = viewAltitude;
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    
    const dx = e.clientX - startMouseX;
    const dy = e.clientY - startMouseY;
    
    // カメラの視野角(ズーム)に応じてドラッグ感度を変更
    const sensitivity = 0.15 * (camera.fov / 60.0);
    
    // 左右で方位角 (Azimuth) を回転
    viewAzimuth = (startAzimuth + dx * sensitivity) % 360.0;
    if (viewAzimuth < 0) viewAzimuth += 360.0;
    
    // 上下で仰角 (Altitude) を変更 (特異点を避けるため 5度 ~ 89.9度 に制限)
    viewAltitude = startAltitude - dy * sensitivity;
    viewAltitude = Math.max(5.0, Math.min(89.9, viewAltitude));
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
  });

  // マウスホイールによるカメラ fov (視野角) ズーム制御
  webglCanvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    
    // 視野角を狭める = ズームイン, 広げる = ズームアウト
    if (e.deltaY < 0) {
      camera.fov /= 1.08; // ズームイン
    } else {
      camera.fov *= 1.08; // ズームアウト
    }
    
    // fov の最大・最小の制限 (10度 ~ 75度)
    camera.fov = Math.max(10.0, Math.min(75.0, camera.fov));
    camera.updateProjectionMatrix();
  }, { passive: false });

  // レスポンシブ対応 (3D レンダラーとオーバーレイをコンテナにフィット)
  const resizeViewport = () => {
    const container = document.getElementById('planetarium-viewport')!;
    const size = Math.min(container.clientWidth, container.clientHeight, 800);
    
    webglCanvas.width = size;
    webglCanvas.height = size;
    overlayCanvas.width = size;
    overlayCanvas.height = size;
    
    renderer.setSize(size, size);
    camera.aspect = 1;
    camera.updateProjectionMatrix();
  };

  window.addEventListener('resize', resizeViewport);
  resizeViewport();
  
  // 初期リサイズ遅延実行 (コンテナ構築待ち用)
  setTimeout(resizeViewport, 100);
}

// ==========================================
// 更新ループ
// ==========================================

function updateTime() {
  if (isTimeFlowing) {
    const elapsedMs = 16.7 * timeSpeed;
    currentDate = new Date(currentDate.getTime() + elapsedMs);
    
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

// プラネタリウムの起動
async function start() {
  init3D();
  initEvents();
  await loadStarCatalog();
  tick();
}

window.addEventListener('DOMContentLoaded', start);
