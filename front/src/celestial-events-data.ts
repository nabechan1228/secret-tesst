export interface CelestialEvent {
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

export const CELESTIAL_EVENTS: Record<string, CelestialEvent> = {
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

export interface MeteorShower {
  name: string;
  ra: number; // hours
  dec: number; // degrees
  color: string;
}

export const METEOR_SHOWERS: Record<string, MeteorShower> = {
  perseids: { name: 'ペルセウス座流星群', ra: 3.1, dec: 58.0, color: '#e0f7fa' },
  geminids: { name: 'ふたご座流星群', ra: 7.5, dec: 33.0, color: '#fff9c4' },
  quadrantids: { name: 'しぶんぎ座流星群', ra: 15.3, dec: 49.0, color: '#e1bee7' },
  lyrids: { name: 'こと座流星群', ra: 18.2, dec: 34.0, color: '#f1f8e9' }
};
