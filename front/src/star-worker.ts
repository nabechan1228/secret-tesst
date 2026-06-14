// star-worker.ts
// 恒星および星座線の地平座標・3D座標変換処理をバックグラウンドで行うWorker

interface WorkerStar {
  id: number;
  ra: number;
  dec: number;
  mag: number;
  radius: number;
}

interface WorkerSegment {
  ra1: number; dec1: number;
  ra2: number; dec2: number;
}

const LAYER_DIM = 650;
const LAYER_MID = 500;
const LAYER_BRIGHT = 350;
const LAYER_CONSTEL = 480;

function starLayerRadius(mag: number): number {
  if (mag < 2.0) return LAYER_BRIGHT;
  if (mag < 4.0) return LAYER_MID;
  return LAYER_DIM;
}

let stars: WorkerStar[] = [];
let segments: WorkerSegment[] = [];

self.onmessage = (e: MessageEvent) => {
  const data = e.data;
  if (!data) return;

  if (data.type === 'init') {
    // 恒星データの初期化
    const rawStars = data.stars || [];
    stars = rawStars.map((s: any) => ({
      id: s.id,
      ra: s.ra,
      dec: s.dec,
      mag: s.mag,
      radius: starLayerRadius(s.mag),
    }));

    // 星座線セグメントデータの初期化（フラットな配列に変換して保持）
    const rawConstellations = data.constellations || [];
    segments = [];
    rawConstellations.forEach((c: any) => {
      if (c.segments) {
        c.segments.forEach((seg: any) => {
          segments.push({
            ra1: seg.ra1, dec1: seg.dec1,
            ra2: seg.ra2, dec2: seg.dec2,
          });
        });
      }
    });


  } else if (data.type === 'update') {
    const { lst, latitude } = data;
    const radPerDeg = Math.PI / 180.0;
    const latRad = latitude * radPerDeg;
    const cosLat = Math.cos(latRad);
    const sinLat = Math.sin(latRad);

    // 1. 恒星の計算
    const starCount = stars.length;
    const starCoords = new Float32Array(starCount * 4);

    for (let i = 0; i < starCount; i++) {
      const star = stars[i];

      const haDeg = lst - (star.ra * 15.0);
      const haRad = haDeg * radPerDeg;

      const decRad = star.dec * radPerDeg;
      const cosDec = Math.cos(decRad);
      const sinDec = Math.sin(decRad);

      let sinAlt = sinLat * sinDec + cosLat * cosDec * Math.cos(haRad);
      sinAlt = Math.max(-1.0, Math.min(1.0, sinAlt));
      const altRad = Math.asin(sinAlt);

      const y = -Math.sin(haRad) * cosDec;
      const x = cosLat * sinDec - sinLat * cosDec * Math.cos(haRad);
      let azRad = Math.atan2(y, x);
      if (azRad < 0) {
        azRad += 2 * Math.PI;
      }

      const r = star.radius;
      const cosAlt = Math.cos(altRad);
      const rx = r * cosAlt * Math.sin(azRad);
      const ry = r * Math.sin(altRad);
      const rz = -r * cosAlt * Math.cos(azRad);

      const isVisible = altRad >= -0.034906585 ? 1.0 : 0.0; // alt >= -2 deg

      const idx = i * 4;
      starCoords[idx] = rx;
      starCoords[idx + 1] = ry;
      starCoords[idx + 2] = rz;
      starCoords[idx + 3] = isVisible;
    }

    // 2. 星座線の計算
    const segCount = segments.length;
    const constCoords = new Float32Array(segCount * 6);
    let constIdx = 0;

    let validCount = 0;
    for (let i = 0; i < segCount; i++) {
      const seg = segments[i];

      // 点1 の計算
      const ha1 = (lst - seg.ra1 * 15.0) * radPerDeg;
      const decRad1 = seg.dec1 * radPerDeg;
      const cosDec1 = Math.cos(decRad1);
      const sinDec1 = Math.sin(decRad1);
      let sinAlt1 = sinLat * sinDec1 + cosLat * cosDec1 * Math.cos(ha1);
      sinAlt1 = Math.max(-1.0, Math.min(1.0, sinAlt1));
      const altRad1 = Math.asin(sinAlt1);

      // 点2 の計算
      const ha2 = (lst - seg.ra2 * 15.0) * radPerDeg;
      const decRad2 = seg.dec2 * radPerDeg;
      const cosDec2 = Math.cos(decRad2);
      const sinDec2 = Math.sin(decRad2);
      let sinAlt2 = sinLat * sinDec2 + cosLat * cosDec2 * Math.cos(ha2);
      sinAlt2 = Math.max(-1.0, Math.min(1.0, sinAlt2));
      const altRad2 = Math.asin(sinAlt2);

      // 判定条件を少し緩和して地平線から-2度まで許容 (altRad >= -0.0349)
      if (altRad1 >= -0.0349 && altRad2 >= -0.0349) {
        validCount++;
        // 点1
        const cosAlt1 = Math.cos(altRad1);
        const y1 = -Math.sin(ha1) * cosDec1;
        const x1 = cosLat * sinDec1 - sinLat * cosDec1 * Math.cos(ha1);
        let azRad1 = Math.atan2(y1, x1);
        if (azRad1 < 0) azRad1 += 2 * Math.PI;

        const px1 = LAYER_CONSTEL * cosAlt1 * Math.sin(azRad1);
        const py1 = LAYER_CONSTEL * Math.sin(altRad1);
        const pz1 = -LAYER_CONSTEL * cosAlt1 * Math.cos(azRad1);

        // 点2
        const cosAlt2 = Math.cos(altRad2);
        const y2 = -Math.sin(ha2) * cosDec2;
        const x2 = cosLat * sinDec2 - sinLat * cosDec2 * Math.cos(ha2);
        let azRad2 = Math.atan2(y2, x2);
        if (azRad2 < 0) azRad2 += 2 * Math.PI;

        const px2 = LAYER_CONSTEL * cosAlt2 * Math.sin(azRad2);
        const py2 = LAYER_CONSTEL * Math.sin(altRad2);
        const pz2 = -LAYER_CONSTEL * cosAlt2 * Math.cos(azRad2);

        constCoords[constIdx++] = px1;
        constCoords[constIdx++] = py1;
        constCoords[constIdx++] = pz1;
        constCoords[constIdx++] = px2;
        constCoords[constIdx++] = py2;
        constCoords[constIdx++] = pz2;
      }
    }



    // 転送（Transferable）を利用して返却
    self.postMessage({
      type: 'result',
      coords: starCoords,
      constellationCoords: constCoords,
      validConstellationElements: constIdx
    }, [starCoords.buffer, constCoords.buffer] as any);
  }
};
