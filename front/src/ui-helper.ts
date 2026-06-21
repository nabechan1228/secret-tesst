import { ConstellationMeta, PlanetRecommendation, ObsMode } from './types';

export function showToast(msg: string, type: 'info' | 'error' = 'info') {
  const toast = document.getElementById('toast')!;
  if (toast) {
    toast.textContent = msg;
    toast.className = `toast toast-${type} visible`;
    const existingTimer = (toast as any)._timer;
    if (existingTimer) clearTimeout(existingTimer);
    (toast as any)._timer = setTimeout(() => { toast.classList.remove('visible'); }, 4000);
  }
}

export function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function setObsModeDescription(el: HTMLElement, mode: ObsMode) {
  el.textContent = '';

  type ModeConfig = { title: string; specs: string[]; note: string };
  const configs: Record<Exclude<ObsMode, 'none'>, ModeConfig> = {
    binoculars: {
      title: '双眼鏡シミュレーション (7x50 相当)',
      specs: [
        '・倍率: 7倍 / 対物有効径: 50mm',
        '・実視野 (TFOV): 7.5°',
        '・ズーム制限: 4.0° 〜 15.0° (ホイール操作可)',
      ],
      note: '手軽に星域をスキャンするのに最適です。天の川や明るい星団が美しく見えます。',
    },
    telescope: {
      title: '望遠鏡シミュレーション (中倍率・レチクル)',
      specs: [
        '・口径: 200mm / 焦点距離: 1000mm (F5)',
        '・実視野 (TFOV): 1.0° (レチクル照準付き)',
        '・ズーム制限: 0.2° 〜 4.0° (ホイール操作可)',
      ],
      note: '月、惑星の表面、遠方の星雲・星団（DSO）をクローズアップして観測できます。',
    },
  };

  if (mode === 'none') return;
  const cfg = configs[mode];

  const strong = document.createElement('strong');
  strong.textContent = cfg.title;
  el.appendChild(strong);

  cfg.specs.forEach(spec => {
    el.appendChild(document.createElement('br'));
    el.append(spec);
  });

  el.appendChild(document.createElement('br'));
  const noteSpan = document.createElement('span');
  noteSpan.style.cssText = 'color:var(--text-secondary); opacity: 0.8; font-size: 0.72rem;';
  noteSpan.textContent = cfg.note;
  el.appendChild(noteSpan);
}

export function populateConstellationSelect(constellationMeta: Record<string, ConstellationMeta>) {
  const select = document.getElementById('constellation-select') as HTMLSelectElement;
  if (!select) return;

  while (select.firstChild) select.removeChild(select.firstChild);
  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = '-- 星座を選択 --';
  select.appendChild(defaultOpt);

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

export function updatePlanetTrackerUI(
  planetRecommendation: PlanetRecommendation | null
) {
  const infoEl = document.getElementById('planet-tracker-info');
  const controlsEl = document.getElementById('planet-tracker-controls');
  if (!infoEl || !controlsEl) return;

  if (!planetRecommendation || planetRecommendation.score === 0) {
    infoEl.innerHTML = '';
    const msgEl = document.createElement('div');
    msgEl.style.cssText = 'font-size:0.82rem;color:var(--text-muted);';
    msgEl.textContent = '今夜は肉眼で見頃な惑星はありません。';
    infoEl.appendChild(msgEl);
    controlsEl.style.display = 'none';
    return;
  }

  infoEl.innerHTML = '';

  const titleEl = document.createElement('div');
  titleEl.style.cssText = 'font-size:0.9rem;font-weight:bold;color:var(--gold);margin-bottom:6px;display:flex;align-items:center;gap:4px;';
  titleEl.textContent = `🪐 今夜の見頃: ${planetRecommendation.name_ja} (${planetRecommendation.name})`;
  infoEl.appendChild(titleEl);

  const detailEl = document.createElement('div');
  detailEl.style.cssText = 'font-size:0.75rem;color:var(--text-secondary);margin-bottom:6px;line-height:1.4;';
  detailEl.textContent = `明るさ: ${planetRecommendation.mag}等 / 最大高度: ${planetRecommendation.max_alt}°`;
  const brEl = document.createElement('br');
  detailEl.appendChild(brEl);
  detailEl.append(`時間帯: ${planetRecommendation.time_range}`);
  infoEl.appendChild(detailEl);

  const commentEl = document.createElement('div');
  commentEl.style.cssText = 'font-size:0.78rem;color:var(--text-primary);line-height:1.6;background:rgba(255,255,255,0.03);padding:10px;border-radius:10px;border:1px solid rgba(80,160,255,0.08);';
  commentEl.textContent = planetRecommendation.comment;
  infoEl.appendChild(commentEl);

  controlsEl.style.display = 'flex';
}

export function showConstellationInfo(cid: string, constellationMeta: Record<string, ConstellationMeta>) {
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

  nameEl.textContent = '';
  const jaSpan = document.createElement('span');
  jaSpan.className = 'const-name-ja';
  jaSpan.textContent = meta.name_ja;
  nameEl.appendChild(jaSpan);
  nameEl.append(' ');
  const enSpan = document.createElement('span');
  enSpan.className = 'const-name-en';
  enSpan.textContent = meta.name_en;
  nameEl.appendChild(enSpan);
  descEl.textContent = meta.desc;
  seasonEl.textContent = seasonMap[meta.season] || meta.season;

  panel.classList.add('visible');
}

export function hideConstellationInfo() {
  const panel = document.getElementById('constellation-info-panel')!;
  if (panel) {
    panel.classList.remove('visible');
  }
}
