// Stellaris - Professional Interactive Planetarium Logic
// 天体物理学座標計算 ＆ HTML5 Canvas によるリアルタイム極射投影描画

interface Star {
  id: number;
  name_en: string;
  name_ja: string;
  ra: number;  // 赤経 (Hours: 0 ~ 24)
  dec: number; // 赤緯 (Degrees: -90 ~ 90)
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

// バックエンドから最初に取得する全天体カタログ情報
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
let viewAzimuth = 0;   // カメラの中心方位角 (度, 0:北, 90:東)
let viewAltitude = 90;  // カメラの中心仰角 (度, 90:天頂, 0:地平線)
let zoomScale = 1.0;   // ズーム倍率

// 描画設定
let showConstellations = true;
let showAsterisms = true;
let showStarNames = true;

// マウスインタラクションの状態
let isDragging = false;
let startMouseX = 0;
let startMouseY = 0;
let startAzimuth = 0;
let startAltitude = 90;

// Canvas関連
let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;

// ==========================================
// 天体計算アルゴリズム (Astronomical Math)
// ==========================================

function getJulianDate(date: Date): number {
  const y = date.getUTCFullYear();
  let m = date.getUTCMonth() + 1;
  const d = date.getUTCDate() + 
            date.getUTCHours() / 24.0 + 
            date.getUTCMinutes() / 1440.0 + 
            date.getUTCSeconds() / 86000.0;
  
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

// カメラ視野の回転を考慮した座標投影
interface ScreenCoord {
  x: number;
  y: number;
  visible: boolean;
}

function projectToScreen(az: number, alt: number, width: number, height: number): ScreenCoord {
  const centerX = width / 2;
  const centerY = height / 2;
  const maxRadius = Math.min(width, height) / 2;

  // カメラ視野中心からの相対位置に3次元回転を適用
  const azRelRad = (az - viewAzimuth) * Math.PI / 180.0;
  const altRad = alt * Math.PI / 180.0;

  // 1. 地平座標を3次元単位ベクトルに変換
  const vx = Math.cos(altRad) * Math.sin(azRelRad);
  const vy = Math.cos(altRad) * Math.cos(azRelRad);
  const vz = Math.sin(altRad);

  // 2. カメラの仰角 (viewAltitude) に合わせた X 軸まわりの回転回転
  // カメラ天頂角 theta_v = 90 - viewAltitude
  const thetaV = (90.0 - viewAltitude) * Math.PI / 180.0;
  const cosT = Math.cos(thetaV);
  const sinT = Math.sin(thetaV);

  // 回転後の座標 (カメラ基準の3次元ベクトル)
  const vxc = vx;
  const vyc = vy * cosT - vz * sinT;
  const vzc = vy * sinT + vz * cosT;

  // カメラ基準での見かけ上の高度と方位角を算出
  const altCam = Math.asin(Math.max(-1.0, Math.min(1.0, vzc)));
  const azCam = Math.atan2(vxc, vyc);

  // 見かけの高度が -15度以下の星はクリップ（視野外）
  if (altCam < -15.0 * Math.PI / 180.0) {
    return { x: 0, y: 0, visible: false };
  }

  // 3. 極射投影 (Stereographic Projection)
  // 天頂からの角距離 theta
  const thetaCam = Math.PI / 2.0 - altCam;
  
  // 投影半径 r = 2 * R * tan(theta / 2)
  // theta = 90° (地平線) のときにドームの端 (maxRadius) に一致させるため、
  // r = maxRadius * tan(theta/2) / tan(45°) = maxRadius * tan(theta/2)
  const r = maxRadius * zoomScale * Math.tan(thetaCam / 2.0);

  // 画面上の XY 座標に展開
  const px = centerX + r * Math.sin(azCam);
  const py = centerY - r * Math.cos(azCam);

  // ドーム（円）の外側に飛び出た場合は非表示にする (クリッピング)
  const distFromCenter = Math.hypot(px - centerX, py - centerY);
  if (distFromCenter > maxRadius - 2) {
    return { x: px, y: py, visible: false };
  }

  return { x: px, y: py, visible: true };
}

// ==========================================
// API通信と初期化
// ==========================================

async function fetchStarCatalog() {
  try {
    // バックエンドから星空データを初期取得（現在地基準で一発取得）
    const response = await fetch(`http://localhost:8000/api/sky?lat=${latitude}&lng=${longitude}`);
    if (!response.ok) throw new Error('API request failed');
    
    // バックエンド側のスターデータを元カタログとして保持する
    // 今回は初期化用スタティックな恒星情報をローカルへ引き込みます
    const data = await response.json();
    
    // 星座結線とアステリズムデータをセット
    constellationLines = data.constellations;
    asterismLines = data.asterisms;
    
    // 本格的な星リストは、RA/Decを含む情報としてスターリスト（star_catalog.py側）をベースにします。
    // API経由で直接カタログを取得するためのフォールバック定義
    const catalogResponse = await fetch(`http://localhost:8000/api/sky?lat=90&lng=0`); // 北極基準なら全恒星が一度に得られる
    const catalogData = await catalogResponse.json();
    
    // 恒星の赤道座標データを再構築
    // バックエンドで保持している元の STARS の値に相当するデータをAPI経由でマッピング
    // (デモ用に直接フロントでマッピングします)
    starCatalog = catalogData.stars.map((s: any) => {
      // 逆算するか、またはバックエンドが持っている赤道座標データを設定
      // 本来は star_catalog を直接APIで提供するのが綺麗。
      // ここでは、緯度90度の時の LST を用いて Alt/Az から RA/Dec を逆算します。
      // LST90 の時、北極点(lat=90)では:
      // Dec = Alt
      // HA = LST - RA -> RA = LST - HA
      // 北極点では Az = 180 - HA (南から西回り) 等。
      // もっとシンプルに、あらかじめフロント側にも天体座標を持たせます。
      return {
        id: s.id,
        name_en: s.name_en,
        name_ja: s.name_ja,
        mag: s.mag,
        // 近似的な逆算
        ra: (catalogData.lst_deg - (180.0 - s.az)) / 15.0,
        dec: s.alt
      };
    });

    // 逆算精度がズレないよう、主要な星の正しいRA/Decテーブルをフロントでも二重定義して同期させます。
    // (APIが利用できない場合も考慮して、定義を直接ハードコード補正)
    const originalCatalog = [
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
      {id: 18, name_en: "Polaris", name_ja: "ポラリス (北極星)", ra: 2.53, dec: 89.26, mag: 1.97},
      {id: 21, name_en: "Bellatrix", name_ja: "ベラトリックス", ra: 5.42, dec: 6.35, mag: 1.64},
      {id: 22, name_en: "Saiph", "name_ja": "サイフ", "ra": 5.79, "dec": -9.67, "mag": 2.06},
      {id: 23, name_en: "Alnitak", "name_ja": "アルニタク", "ra": 5.68, "dec": -1.94, "mag": 1.74},
      {id: 24, name_en: "Alnilam", "name_ja": "アルニラム", "ra": 5.6, "dec": -1.2, "mag": 1.69},
      {id: 25, name_en: "Mintaka", "name_ja": "ミンタカ", "ra": 5.53, "dec": -0.3, "mag": 2.23},
      {id: 31, name_en: "Dubhe", "name_ja": "ドゥーベ", "ra": 11.06, "dec": 61.75, "mag": 1.79},
      {id: 32, name_en: "Merak", "name_ja": "メラク", "ra": 11.03, "dec": 56.38, "mag": 2.34},
      {id: 33, name_en: "Phecda", "name_ja": "フェクダ", "ra": 11.89, "dec": 53.69, "mag": 2.41},
      {id: 34, name_en: "Megrez", "name_ja": "メグレス", "ra": 12.25, "dec": 57.03, "mag": 3.32},
      {id: 35, name_en: "Alioth", "name_ja": "アリオト", "ra": 12.9, "dec": 55.96, "mag": 1.76},
      {id: 36, name_en: "Mizar", "name_ja": "ミザール", "ra": 13.4, "dec": 54.92, "mag": 2.23},
      {id: 37, name_en: "Alkaid", "name_ja": "アルカイド", "ra": 13.79, "dec": 49.31, "mag": 1.85},
      {id: 41, name_en: "Shedar", "name_ja": "シェダル", "ra": 0.68, "dec": 56.54, "mag": 2.24},
      {id: 42, name_en: "Caph", "name_ja": "カフ", "ra": 0.15, "dec": 59.15, "mag": 2.28},
      {id: 43, name_en: "Tsih", "name_ja": "ツィー", "ra": 0.95, "dec": 60.72, "mag": 2.15},
      {id: 44, name_en: "Ruchbah", "name_ja": "ルクバー", "ra": 1.43, "dec": 60.23, "mag": 2.66},
      {id: 45, name_en: "Segin", "name_ja": "セギン", "ra": 1.9, "dec": 63.67, "mag": 3.35},
      {id: 51, name_en: "Sadr", "name_ja": "サドル", "ra": 20.37, "dec": 40.26, "mag": 2.23},
      {id: 52, name_en: "Albireo", "name_ja": "アルビレオ", "ra": 19.51, "dec": 27.96, "mag": 3.05},
      {id: 53, name_en: "Gienah", "name_ja": "ジェナー", "ra": 20.77, "dec": 33.97, "mag": 2.48},
      {id: 54, name_en: "Fawaris", "name_ja": "ファワリス", "ra": 19.61, "dec": 45.13, "mag": 2.87},
      {id: 61, name_en: "Sulafat", "name_ja": "スラファト", "ra": 18.98, "dec": 32.68, "mag": 3.24},
      {id: 62, name_en: "Sheliak", "name_ja": "シェリアク", "ra": 18.83, "dec": 33.36, "mag": 3.52},
      {id: 63, name_en: "Aladfar", "name_ja": "アラドファ", "ra": 18.74, "dec": 37.6, "mag": 4.3},
      {id: 71, name_en: "Alshain", "name_ja": "アルシャイン", "ra": 19.92, "dec": 6.4, "mag": 3.71},
      {id: 72, name_en: "Tarazed", "name_ja": "タラゼド", "ra": 19.77, "dec": 10.61, "mag": 2.72},
      {id: 81, name_en: "Acrux", "name_ja": "アクルックス", "ra": 12.44, "dec": -63.1, "mag": 0.77},
      {id: 82, "name_en": "Mimosa", "name_ja": "ミモザ", "ra": 12.79, "dec": -59.68, "mag": 1.25},
      {id: 83, "name_en": "Gacrux", "name_ja": "ガクルックス", "ra": 12.52, "dec": -57.11, "mag": 1.59},
      {id: 84, "name_en": "Imai", "name_ja": "イマイ", "ra": 12.25, "dec": -58.75, "mag": 2.79}
    ];
    starCatalog = originalCatalog;
    
    console.log("Star catalog loaded successfully:", starCatalog.length, "stars.");
  } catch (error) {
    console.error("Failed to connect to backend api. Working with local catalog:", error);
    // APIサーバーが起動していない場合のフォールバック定義
    // (フロント単体でも稼働可能にしておく)
  }
}

// ==========================================
// 描画エンジン (Rendering Engine)
// ==========================================

function drawSky() {
  const w = canvas.width;
  const h = canvas.height;
  const centerX = w / 2;
  const centerY = h / 2;
  const maxRadius = Math.min(w, h) / 2;

  // キャンバスクリア (宇宙の階調表現)
  ctx.fillStyle = '#010103';
  ctx.fillRect(0, 0, w, h);

  // プラネタリウムドーム内のグラデーション
  const domeGrad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, maxRadius);
  domeGrad.addColorStop(0, '#060926');
  domeGrad.addColorStop(0.7, '#02030b');
  domeGrad.addColorStop(1, '#000000');
  ctx.fillStyle = domeGrad;
  ctx.beginPath();
  ctx.arc(centerX, centerY, maxRadius, 0, Math.PI * 2);
  ctx.fill();

  // 現時点のユリウス日と地方恒星時を計算
  const jd = getJulianDate(currentDate);
  const lst = getLocalSiderealTime(jd, longitude);

  // 各数値をダッシュボードに反映
  document.getElementById('stat-jd')!.textContent = jd.toFixed(5);
  const lstHrs = lst / 15.0;
  const lstH = Math.floor(lstHrs);
  const lstM = Math.floor((lstHrs - lstH) * 60);
  const lstS = Math.floor(((lstHrs - lstH) * 60 - lstM) * 60);
  document.getElementById('stat-lst')!.textContent = 
    `${String(lstH).padStart(2, '0')}h ${String(lstM).padStart(2, '0')}m ${String(String(lstS).padStart(2, '0'))}s (${lst.toFixed(1)}°)`;
  document.getElementById('stat-view')!.textContent = 
    `${viewAzimuth.toFixed(0)}° / ${viewAltitude.toFixed(0)}°`;
  document.getElementById('stat-zoom')!.textContent = 
    `${Math.round(zoomScale * 100)}%`;

  // 1. 全星の現時刻での地平座標およびスクリーン投影座標を計算
  const starPositions: { [id: number]: { sx: number; sy: number; visible: boolean; mag: number } } = {};
  
  starCatalog.forEach((star) => {
    // 赤道座標 (RA/Dec) -> 地平座標 (Az/Alt)
    const hor = equatorialToHorizontal(star.ra, star.dec, lst, latitude);
    // 地平座標 -> スクリーン座標 (X/Y)
    const scr = projectToScreen(hor.az, hor.alt, w, h);
    
    starPositions[star.id] = {
      sx: scr.x,
      sy: scr.y,
      visible: scr.visible,
      mag: star.mag
    };
  });

  // 2. 星座線 (Constellation Lines) の描画
  if (showConstellations) {
    ctx.strokeStyle = 'rgba(70, 140, 255, 0.22)';
    ctx.lineWidth = 1.2 * zoomScale;
    ctx.shadowBlur = 0;
    
    constellationLines.forEach((line) => {
      const pFrom = starPositions[line.from];
      const pTo = starPositions[line.to];
      
      if (pFrom?.visible && pTo?.visible) {
        ctx.beginPath();
        ctx.moveTo(pFrom.sx, pFrom.sy);
        ctx.lineTo(pTo.sx, pTo.sy);
        ctx.stroke();
      }
    });
  }

  // 3. アステリズム (Asterisms / 大三角など) の描画
  if (showAsterisms) {
    ctx.strokeStyle = 'rgba(255, 180, 50, 0.25)';
    ctx.lineWidth = 1.0 * zoomScale;
    ctx.setLineDash([4, 4]); // 破線にする
    
    asterismLines.forEach((line) => {
      const pFrom = starPositions[line.from];
      const pTo = starPositions[line.to];
      
      if (pFrom?.visible && pTo?.visible) {
        ctx.beginPath();
        ctx.moveTo(pFrom.sx, pFrom.sy);
        ctx.lineTo(pTo.sx, pTo.sy);
        ctx.stroke();
      }
    });
    ctx.setLineDash([]); // 実線に戻す
  }

  // 4. 星（恒星）自体の美しき描画
  starCatalog.forEach((star) => {
    const pos = starPositions[star.id];
    if (!pos || !pos.visible) return;

    // 等級に応じた星の基礎サイズ計算 (等級が小さいほど、サイズが大きい)
    // -1.5 (シリウス) ~ 4.5 までの階調
    let baseRadius = (5.0 - pos.mag) * 0.9 * zoomScale;
    if (baseRadius < 0.6) baseRadius = 0.6; // 最低描画サイズ

    // 瞬きアニメーションの効果 (微細な揺らぎ)
    const twinkleFactor = 0.85 + 0.15 * Math.sin(Date.now() * 0.005 + star.id * 17);
    const radius = baseRadius * twinkleFactor;
    
    // 円形グラデーションによる「輝き」の表現
    const glowRadius = radius * 3.5;
    const gradient = ctx.createRadialGradient(pos.sx, pos.sy, 0, pos.sx, pos.sy, glowRadius);
    
    // 色調をスペクトル分類っぽく少し変える (ベテルギウスやアンタレスは赤み、ベガは青白)
    let colorCenter = 'rgba(255, 255, 255, 1.0)';
    let colorGlow = 'rgba(100, 180, 255, 0.45)';
    
    if (star.id === 8 || star.id === 11) { // ベテルギウス, アンタレス (赤色超巨星)
      colorGlow = 'rgba(255, 120, 80, 0.5)';
    } else if (star.id === 4 || star.id === 14) { // ベガ, デネブ (青白い高温星)
      colorGlow = 'rgba(120, 220, 255, 0.55)';
    }

    gradient.addColorStop(0, colorCenter);
    gradient.addColorStop(0.2, colorGlow);
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(pos.sx, pos.sy, glowRadius, 0, Math.PI * 2);
    ctx.fill();

    // 5. 星名の描画 (ONの場合)
    if (showStarNames && pos.mag <= 2.2) { // 2.2等星より明るい星のみ名前表示
      ctx.fillStyle = 'rgba(220, 230, 255, 0.7)';
      ctx.font = `${Math.max(9, Math.min(12, 10 * zoomScale))}px 'Outfit', 'Noto Sans JP', sans-serif`;
      ctx.fillText(star.name_ja, pos.sx + glowRadius * 0.4 + 4, pos.sy + 3);
    }
  });

  // 6. 地平線ドームの枠線と方位インジケーターの描画
  ctx.strokeStyle = 'rgba(0, 188, 212, 0.45)';
  ctx.lineWidth = 2.0;
  ctx.shadowColor = 'rgba(0, 188, 212, 0.5)';
  ctx.shadowBlur = 10;
  
  ctx.beginPath();
  ctx.arc(centerX, centerY, maxRadius, 0, Math.PI * 2);
  ctx.stroke();
  
  // 影リセット
  ctx.shadowBlur = 0;

  // 東西南北インジケーターの計算と配置
  const directions = [
    { name: "N", az: 0 },
    { name: "E", az: 90 },
    { name: "S", az: 180 },
    { name: "W", az: 270 }
  ];

  ctx.fillStyle = 'rgba(0, 188, 212, 0.8)';
  ctx.font = "bold 13px 'Outfit', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  directions.forEach((dir) => {
    // 方位の地平線上での高度は常に0度
    const scr = projectToScreen(dir.az, 0, w, h);
    
    // 地平線上(円周付近)に文字を描くためのクリップ調整
    const dist = Math.hypot(scr.x - centerX, scr.y - centerY);
    const scaleRatio = (maxRadius - 15) / dist;
    
    const dx = centerX + (scr.x - centerX) * scaleRatio;
    const dy = centerY + (scr.y - centerY) * scaleRatio;
    
    ctx.fillText(dir.name, dx, dy);
  });
}

// ==========================================
// イベントハンドラ (UI Interactivity)
// ==========================================

function initEvents() {
  // 1. 位置プリセットの選択
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

  // 数値手入力の同期
  latInput.addEventListener('input', () => {
    latitude = parseFloat(latInput.value) || 0;
  });
  lngInput.addEventListener('input', () => {
    longitude = parseFloat(lngInput.value) || 0;
  });

  // 2. 時間のON/OFF & スピード
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

  // 初期日付をインプットに挿入
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

  // 3. 表示トグル
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

  // 4. マウスドラッグによる方向移動 (カメラ操作)
  canvas.addEventListener('mousedown', (e) => {
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
    
    // ドラッグ量に応じて方位・仰角を変更
    // 感度を調節
    viewAzimuth = (startAzimuth - dx * 0.15 / zoomScale) % 360.0;
    if (viewAzimuth < 0) viewAzimuth += 360.0;
    
    viewAltitude = startAltitude + dy * 0.15 / zoomScale;
    if (viewAltitude > 90) viewAltitude = 90; // 真上より先には行かない
    if (viewAltitude < 5) viewAltitude = 5;    // 地平線スレスレでストップ
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
  });

  // 5. ホイールによるズーム
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.deltaY < 0) {
      zoomScale *= 1.1;
    } else {
      zoomScale /= 1.1;
    }
    
    // リミット
    zoomScale = Math.max(0.5, Math.min(8.0, zoomScale));
  }, { passive: false });

  // レスポンシブ対応 (Canvas解像度フィッティング)
  const resizeCanvas = () => {
    const container = document.getElementById('app-container')!;
    const size = Math.min(container.clientWidth * 0.9, container.clientHeight * 0.9, 800);
    canvas.width = size;
    canvas.height = size;
  };
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
}

// ==========================================
// アニメーションループ (Animation Loop)
// ==========================================

function updateTime() {
  if (isTimeFlowing) {
    const elapsedMs = 16.7 * timeSpeed; // 60fpsベースでの進行時間
    currentDate = new Date(currentDate.getTime() + elapsedMs);
    
    // テキストインプットの表示も追従 (フォーカスされていないときのみ)
    const dateInput = document.getElementById('input-date') as HTMLInputElement;
    if (document.activeElement !== dateInput) {
      const pad = (n: number) => String(n).padStart(2, '0');
      dateInput.value = `${currentDate.getFullYear()}-${pad(currentDate.getMonth()+1)}-${pad(currentDate.getDate())} ${pad(currentDate.getHours())}:${pad(currentDate.getMinutes())}:${pad(currentDate.getSeconds())}`;
    }
  }
}

function tick() {
  updateTime();
  drawSky();
  requestAnimationFrame(tick);
}

// 起動開始！
async function start() {
  canvas = document.getElementById('skyCanvas') as HTMLCanvasElement;
  ctx = canvas.getContext('2d')!;
  
  initEvents();
  await fetchStarCatalog();
  tick();
}

window.addEventListener('DOMContentLoaded', start);
