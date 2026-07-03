/** 天体写真撮影対象のメタデータ（固定アセットパスのみ — ユーザー入力不可） */

export interface DsoInfo {
  nameJa: string;
  type: string;
  file: string;
}

export const DSO_INFO_MAP: Record<string, DsoInfo> = {
  M31: { nameJa: 'アンドロメダ銀河', type: '渦巻銀河 (DSO)', file: 'm31.png' },
  M42: { nameJa: 'オリオン大星雲', type: '散光星雲 (DSO)', file: 'm42.png' },
  M45: { nameJa: 'プレアデス星団 (すばる)', type: '散開星団 (DSO)', file: 'm45.png' },
  M6: { nameJa: 'バタフライ星団', type: '散開星団 (DSO)', file: 'm6.png' },
  M7: { nameJa: 'プトレマイオス星団', type: '散開星団 (DSO)', file: 'm7.png' },
  M11: { nameJa: '野鴨星団', type: '散開星団 (DSO)', file: 'm11.png' },
  M15: { nameJa: 'ペガスス座球状星団', type: '球状星団 (DSO)', file: 'm15.png' },
  M24: { nameJa: 'いて座スタークラウド', type: '天の川の濃い部分 (DSO)', file: 'm24.png' },
  M35: { nameJa: 'M35散開星団', type: '散開星団 (DSO)', file: 'm35.png' },
  M78: { nameJa: 'M78反射星雲', type: '反射星雲 (DSO)', file: 'm78.png' },
  M83: { nameJa: '南の回転花火銀河', type: '棒渦巻銀河 (DSO)', file: 'm83.png' },
  M90: { nameJa: 'M90渦巻銀河', type: '渦巻銀河 (DSO)', file: 'm90.png' },
  IC434: { nameJa: '馬頭星雲', type: '暗黒星雲 (DSO)', file: 'ic434.png' },
  NGC2237: { nameJa: 'バラ星雲', type: '散光星雲 (DSO)', file: 'ngc2237.png' },
  NGC869: { nameJa: '二重星団', type: '散開星団 (DSO)', file: 'ngc869.png' },
  NGC7000: { nameJa: '北アメリカ星雲', type: '散光星雲 (DSO)', file: 'ngc7000.png' },
  NGC6960: { nameJa: '網状星雲', type: '超新星残骸 (DSO)', file: 'ngc6960.png' },
  NGC7293: { nameJa: 'らせん星雲', type: '惑星状星雲 (DSO)', file: 'ngc7293.png' },
  NGC6543: { nameJa: 'キャッツアイ星雲', type: '惑星状星雲 (DSO)', file: 'ngc6543.png' },
  Moon: { nameJa: '月', type: '衛星', file: 'moon.png' },
  Sun: { nameJa: '太陽', type: '恒星', file: 'sun.png' },
  Mercury: { nameJa: '水星', type: '惑星', file: 'mercury.png' },
  Venus: { nameJa: '金星', type: '惑星', file: 'venus.png' },
  Mars: { nameJa: '火星', type: '惑星', file: 'mars.png' },
  Jupiter: { nameJa: '木星', type: '惑星', file: 'jupiter.png' },
  Saturn: { nameJa: '土星', type: '惑星', file: 'saturn.png' },
  Uranus: { nameJa: '天王星', type: '惑星', file: 'uranus.png' },
  Neptune: { nameJa: '海王星', type: '惑星', file: 'neptune.png' },
  Pluto: { nameJa: '冥王星', type: '準惑星', file: 'pluto.png' },
};

/** localStorage から読み込んだ ID が既知 DSO か検証する */
export function resolveDsoAsset(id: string): DsoInfo | null {
  return DSO_INFO_MAP[id] ?? null;
}
