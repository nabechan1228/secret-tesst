/** 共通 fetch ユーティリティ（エラーハンドリング統一） */

export async function fetchJson<T>(
  url: string,
  label = 'API'
): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`${label}: HTTP ${res.status} for ${url}`);
      return null;
    }
    return await res.json() as T;
  } catch (err) {
    console.warn(`${label}: fetch failed for ${url}`, err);
    return null;
  }
}

let satelliteErrorShown = false;

/** 衛星 API 取得失敗時は初回のみ警告を出す */
export function warnSatelliteFetchOnce(): void {
  if (!satelliteErrorShown) {
    satelliteErrorShown = true;
    console.warn('衛星データの取得に失敗しました。次回更新時に再試行します。');
  }
}

export function resetSatelliteErrorFlag(): void {
  satelliteErrorShown = false;
}
