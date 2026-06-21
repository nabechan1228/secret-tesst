export interface StarData {
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

export interface ConstellationSegment {
  ra1: number;
  dec1: number;
  ra2: number;
  dec2: number;
}

export interface ConstellationLineData {
  cid: string;
  segments: ConstellationSegment[];
}

export interface ConstellationMeta {
  name_ja: string;
  name_en: string;
  name_la: string;
  season: string;
  desc: string;
  center_ra: number;
  center_dec: number;
  rank: number;
}

export interface PlanetRecommendation {
  name: string;
  name_ja: string;
  score: number;
  mag: number;
  max_alt: number;
  visible_hours: number;
  time_range: string;
  comment: string;
}

export interface PlanetData {
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

export interface DSOData {
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

export interface AsterismGuide {
  name_ja: string;
  name_en: string;
  desc: string;
  season: string;
  starIds: number[];
  linePairs: [number, number][];
}

export type ObsMode = 'none' | 'binoculars' | 'telescope';
