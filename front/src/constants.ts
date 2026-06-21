import { AsterismGuide } from './types';

export const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:8000';

export const PLANETS_DSO_UPDATE_INTERVAL_MS = 30000;
export const PLANETS_DSO_TIMELAPSE_UPDATE_INTERVAL_MS = 1500;
export const DOME_RADIUS = 500;
export const LAYER_MILKYWAY = 900;
export const INTRO_DURATION = 3000;

export const DSO_FIXED_COORDS: Record<string, { ra: number; dec: number }> = {
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

export const ASTERISM_GUIDES: Record<string, AsterismGuide> = {
  'summer-triangle': {
    name_ja: '夏の大三角',
    name_en: 'Summer Triangle',
    desc: 'こと座のベガ、わし座のアルタイル、はくちょう座のデネブを結んでできる巨大な三角形。天の川をまたぐように配置されており、夏の夜空を象徴する重要な目印です。',
    season: '🌸〜🍂 夏（見頃は7月〜9月）',
    starIds: [91262, 97649, 102098],
    linePairs: [[0, 1], [1, 2], [2, 0]]
  },
  'winter-triangle': {
    name_ja: '冬の大三角',
    name_en: 'Winter Triangle',
    desc: 'おおいぬ座 of シリウス、こいぬ座のプロキオン、オリオン座のベテルギウスを結んでできる正三角形。冬の夜空でひときわ明るく輝く恒星たちの共演です。',
    season: '🍂〜🌸 冬（見頃は12月〜3月）',
    starIds: [32349, 37279, 27989],
    linePairs: [[0, 1], [1, 2], [2, 0]]
  },
  'spring-triangle': {
    name_ja: '春の大三角',
    name_en: 'Spring Triangle',
    desc: 'うしかい座のアークトゥルス、おとめ座のスピカ、しし座のデネボラを結んでできる広大な三角形。春の穏やかな夜空に大きく描かれます。',
    season: '❄️〜☀️ 春（見頃は4月〜6月）',
    starIds: [69673, 65474, 57632],
    linePairs: [[0, 1], [1, 2], [2, 0]]
  },
  'big-dipper': {
    name_ja: '北斗七星',
    name_en: 'Big Dipper',
    desc: 'おおぐま座の腰と尾を構成する7つの明るい星。ひしゃくの形をしており、古来より北極星を見つけるためのガイドとして使われてきました。',
    season: '🌐 通年（春に最も高く昇る）',
    starIds: [54061, 53910, 58001, 59774, 62956, 65378, 67301],
    linePairs: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [3, 0]]
  },
  'cassiopeia': {
    name_ja: 'カシオペヤ座 (W字)',
    name_en: 'Cassiopeia (W-shape)',
    desc: '秋の北天で美しく輝くW字型の星群。北極星を挟んで北斗七星のちょうど反対側にあり、北（北極星）を特定する重要な指標です。',
    season: '🌐 通年（秋に最も高く昇る）',
    starIds: [8886, 6686, 4427, 3179, 746],
    linePairs: [[0, 1], [1, 2], [2, 3], [3, 4]]
  }
};
