import { resolveDsoAsset } from './dso-info';
import { showToast } from './ui-helper';

const LOGBOOK_KEY = 'stellaris_observation_log';
const MAX_NAME_LEN = 120;
const MAX_DATE_LEN = 64;

export interface ObsLogEntry {
  id: string;
  name: string;
  type: string;
  date: string;
  lat: number;
  lon: number;
  isPhoto: boolean;
  exp?: number;
  iso?: number;
}

export interface LogData {
  observations: ObsLogEntry[];
  badges: string[];
}

function sanitizeString(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  return value.slice(0, maxLen);
}

function sanitizeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** localStorage から観測ログを安全に読み込む */
export function loadLogData(): LogData {
  try {
    const saved = localStorage.getItem(LOGBOOK_KEY);
    if (!saved) return { observations: [], badges: [] };

    const raw = JSON.parse(saved);
    if (!raw || typeof raw !== 'object') return { observations: [], badges: [] };

    const observations: ObsLogEntry[] = [];
    if (Array.isArray(raw.observations)) {
      for (const item of raw.observations) {
        if (!item || typeof item !== 'object') continue;
        const id = sanitizeString(item.id, 32);
        if (!id || !resolveDsoAsset(id)) continue;

        observations.push({
          id,
          name: sanitizeString(item.name, MAX_NAME_LEN),
          type: sanitizeString(item.type, 64),
          date: sanitizeString(item.date, MAX_DATE_LEN),
          lat: sanitizeNumber(item.lat),
          lon: sanitizeNumber(item.lon),
          isPhoto: item.isPhoto === true,
          exp: typeof item.exp === 'number' ? item.exp : undefined,
          iso: typeof item.iso === 'number' ? item.iso : undefined,
        });
      }
    }

    const badges: string[] = Array.isArray(raw.badges)
      ? raw.badges.filter((b: unknown) => typeof b === 'string').slice(0, 20)
      : [];

    return { observations, badges };
  } catch {
    return { observations: [], badges: [] };
  }
}

function createEmptyMessage(): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = 'color:var(--text-secondary); font-size:0.8rem; text-align:center; grid-column:span 2; margin-top:40px;';
  el.textContent = 'まだ撮影された写真はありません。';
  return el;
}

function createPhotoCard(entry: ObsLogEntry): HTMLElement | null {
  const asset = resolveDsoAsset(entry.id);
  if (!asset) return null;

  const card = document.createElement('div');
  card.style.cssText = 'background:#fff;color:#111;padding:8px;border-radius:6px;box-shadow:0 4px 10px rgba(0,0,0,0.3);cursor:pointer;transition:transform 0.2s;';

  const imgWrap = document.createElement('div');
  imgWrap.style.cssText = 'width:100%;aspect-ratio:4/3;background:#000;border-radius:3px;overflow:hidden;';

  const img = document.createElement('img');
  img.src = `/assets/${asset.file}`;
  img.alt = asset.nameJa;
  img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
  imgWrap.appendChild(img);

  const meta = document.createElement('div');
  meta.style.cssText = 'margin-top:6px;font-size:0.75rem;text-align:left;';

  const nameEl = document.createElement('div');
  nameEl.style.cssText = 'font-weight:bold;color:#222;';
  nameEl.textContent = entry.name || asset.nameJa;

  const dateEl = document.createElement('div');
  dateEl.style.cssText = 'color:#666;font-size:0.65rem;';
  const datePart = entry.date.split(' ')[0] || entry.date;
  const expText = entry.exp != null ? `${entry.exp}s` : '-';
  dateEl.textContent = `📅 ${datePart} | ⏱ ${expText}`;

  meta.appendChild(nameEl);
  meta.appendChild(dateEl);
  card.appendChild(imgWrap);
  card.appendChild(meta);

  card.onmouseover = () => { card.style.transform = 'scale(1.03)'; };
  card.onmouseout = () => { card.style.transform = 'scale(1.0)'; };

  card.addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = `stellaris_saved_${entry.id}.png`;
    link.href = `/assets/${asset.file}`;
    link.click();
    showToast(`${entry.name || asset.nameJa} の写真をダウンロードしました`, 'info');
  });

  return card;
}

const BADGE_IDS = ['first-light', 'messier-hunter', 'eclipse-chaser', 'city-astrophoto', 'aurora-expedition'] as const;

const BADGE_ELEMENT_MAP: Record<string, string> = {
  'first-light': 'badge-first-light',
  'messier-hunter': 'badge-messier-hunter',
  'eclipse-chaser': 'badge-eclipse-chaser',
  'city-astrophoto': 'badge-city-astrophoto',
  'aurora-expedition': 'badge-aurora-expedition',
};

function updateBadges(badges: string[]) {
  BADGE_IDS.forEach(b => {
    const el = document.getElementById(BADGE_ELEMENT_MAP[b]);
    if (!el) return;
    if (badges.includes(b)) {
      el.style.opacity = '1';
      el.style.background = 'rgba(0, 172, 193, 0.15)';
      el.style.border = '1px solid rgba(0, 172, 193, 0.4)';
    } else {
      el.style.opacity = '0.3';
      el.style.background = 'rgba(255,255,255,0.03)';
      el.style.border = 'none';
    }
  });
}

/** 観測ログブックのギャラリーとバッジを安全に描画する */
export function renderLogbook() {
  const galleryContainer = document.getElementById('logbook-gallery');
  if (!galleryContainer) return;

  const logData = loadLogData();
  galleryContainer.replaceChildren();

  const photos = logData.observations.filter(o => o.isPhoto);
  if (photos.length === 0) {
    galleryContainer.appendChild(createEmptyMessage());
  } else {
    photos.forEach(p => {
      const card = createPhotoCard(p);
      if (card) galleryContainer.appendChild(card);
    });
  }

  updateBadges(logData.badges);
}
