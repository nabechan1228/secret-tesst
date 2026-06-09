# -*- coding: utf-8 -*-

# 星データカタログ
# 実在する主要な恒星データ
# RA (赤経): 0 ~ 24時間 (浮動小数点)
# Dec (赤緯): -90 ~ 90度 (浮動小数点)
# Mag (等級): 数値が小さいほど明るい

STARS = [
    # 21の1等星および主要恒星
    {"id": 1, "name_en": "Sirius", "name_ja": "シリウス", "ra": 6.75, "dec": -16.72, "mag": -1.46},
    {"id": 2, "name_en": "Canopus", "name_ja": "カノープス", "ra": 6.4, "dec": -52.7, "mag": -0.74},
    {"id": 3, "name_en": "Arcturus", "name_ja": "アークトゥルス", "ra": 14.26, "dec": 19.18, "mag": -0.05},
    {"id": 4, "name_en": "Vega", "name_ja": "ベガ", "ra": 18.62, "dec": 38.78, "mag": 0.03},
    {"id": 5, "name_en": "Capella", "name_ja": "カペラ", "ra": 5.28, "dec": 46.0, "mag": 0.08},
    {"id": 6, "name_en": "Rigel", "name_ja": "リゲル", "ra": 5.24, "dec": -8.2, "mag": 0.13},
    {"id": 7, "name_en": "Procyon", "name_ja": "プロキオン", "ra": 7.66, "dec": 5.22, "mag": 0.34},
    {"id": 8, "name_en": "Betelgeuse", "name_ja": "ベテルギウス", "ra": 5.92, "dec": 7.41, "mag": 0.42},
    {"id": 9, "name_en": "Altair", "name_ja": "アルタイル", "ra": 19.85, "dec": 8.87, "mag": 0.76},
    {"id": 10, "name_en": "Aldebaran", "name_ja": "アルデバラン", "ra": 4.6, "dec": 16.51, "mag": 0.85},
    {"id": 11, "name_en": "Antares", "name_ja": "アンタレス", "ra": 16.49, "dec": -26.43, "mag": 1.06},
    {"id": 12, "name_en": "Spica", "name_ja": "スピカ", "ra": 13.42, "dec": -11.16, "mag": 0.98},
    {"id": 13, "name_en": "Pollux", "name_ja": "ポルックス", "ra": 7.75, "dec": 28.02, "mag": 1.14},
    {"id": 14, "name_en": "Deneb", "name_ja": "デネブ", "ra": 20.69, "dec": 45.28, "mag": 1.25},
    {"id": 15, "name_en": "Fomalhaut", "name_ja": "フォーマルハウト", "ra": 22.96, "dec": -29.62, "mag": 1.16},
    {"id": 16, "name_en": "Regulus", "name_ja": "レグルス", "ra": 10.14, "dec": 11.96, "mag": 1.36},
    {"id": 17, "name_en": "Castor", "name_ja": "カストル", "ra": 7.58, "dec": 31.89, "mag": 1.58},
    {"id": 18, "name_en": "Polaris", "name_ja": "ポラリス (北極星)", "ra": 2.53, "dec": 89.26, "mag": 1.97},

    # オリオン座を構成するその他の星
    {"id": 21, "name_en": "Bellatrix", "name_ja": "ベラトリックス", "ra": 5.42, "dec": 6.35, "mag": 1.64},
    {"id": 22, "name_en": "Saiph", "name_ja": "サイフ", "ra": 5.79, "dec": -9.67, "mag": 2.06},
    {"id": 23, "name_en": "Alnitak", "name_ja": "アルニタク", "ra": 5.68, "dec": -1.94, "mag": 1.74},
    {"id": 24, "name_en": "Alnilam", "name_ja": "アルnilam", "ra": 5.6, "dec": -1.2, "mag": 1.69},
    {"id": 25, "name_en": "Mintaka", "name_ja": "ミンタカ", "ra": 5.53, "dec": -0.3, "mag": 2.23},

    # 北斗七星 (おおぐま座の主要部)
    {"id": 31, "name_en": "Dubhe", "name_ja": "ドゥーベ", "ra": 11.06, "dec": 61.75, "mag": 1.79},
    {"id": 32, "name_en": "Merak", "name_ja": "メラク", "ra": 11.03, "dec": 56.38, "mag": 2.34},
    {"id": 33, "name_en": "Phecda", "name_ja": "フェクダ", "ra": 11.89, "dec": 53.69, "mag": 2.41},
    {"id": 34, "name_en": "Megrez", "name_ja": "メグレス", "ra": 12.25, "dec": 57.03, "mag": 3.32},
    {"id": 35, "name_en": "Alioth", "name_ja": "アリオト", "ra": 12.9, "dec": 55.96, "mag": 1.76},
    {"id": 36, "name_en": "Mizar", "name_ja": "ミザール", "ra": 13.4, "dec": 54.92, "mag": 2.23},
    {"id": 37, "name_en": "Alkaid", "name_ja": "アルカイド", "ra": 13.79, "dec": 49.31, "mag": 1.85},

    # カシオペヤ座
    {"id": 41, "name_en": "Shedar", "name_ja": "シェダル", "ra": 0.68, "dec": 56.54, "mag": 2.24},
    {"id": 42, "name_en": "Caph", "name_ja": "カフ", "ra": 0.15, "dec": 59.15, "mag": 2.28},
    {"id": 43, "name_en": "Tsih", "name_ja": "ツィー", "ra": 0.95, "dec": 60.72, "mag": 2.15},
    {"id": 44, "name_en": "Ruchbah", "name_ja": "ルクバー", "ra": 1.43, "dec": 60.23, "mag": 2.66},
    {"id": 45, "name_en": "Segin", "name_ja": "セギン", "ra": 1.9, "dec": 63.67, "mag": 3.35},

    # はくちょう座
    {"id": 51, "name_en": "Sadr", "name_ja": "サドル", "ra": 20.37, "dec": 40.26, "mag": 2.23},
    {"id": 52, "name_en": "Albireo", "name_ja": "アルビレオ", "ra": 19.51, "dec": 27.96, "mag": 3.05},
    {"id": 53, "name_en": "Gienah", "name_ja": "ジェナー", "ra": 20.77, "dec": 33.97, "mag": 2.48},
    {"id": 54, "name_en": "Fawaris", "name_ja": "ファワリス", "ra": 19.61, "dec": 45.13, "mag": 2.87},

    # こと座
    {"id": 61, "name_en": "Sulafat", "name_ja": "スラファト", "ra": 18.98, "dec": 32.68, "mag": 3.24},
    {"id": 62, "name_en": "Sheliak", "name_ja": "シェリアク", "ra": 18.83, "dec": 33.36, "mag": 3.52},
    {"id": 63, "name_en": "Aladfar", "name_ja": "アラドファ", "ra": 18.74, "dec": 37.6, "mag": 4.3},

    # わし座
    {"id": 71, "name_en": "Alshain", "name_ja": "アルシャイン", "ra": 19.92, "dec": 6.4, "mag": 3.71},
    {"id": 72, "name_en": "Tarazed", "name_ja": "タラゼド", "ra": 19.77, "dec": 10.61, "mag": 2.72},
    
    # 南十字星 (サザンクロス) - 南半球検証用
    {"id": 81, "name_en": "Acrux", "name_ja": "アクルックス", "ra": 12.44, "dec": -63.1, "mag": 0.77},
    {"id": 82, "name_en": "Mimosa", "name_ja": "ミモザ", "ra": 12.79, "dec": -59.68, "mag": 1.25},
    {"id": 83, "name_en": "Gacrux", "name_ja": "ガクルックス", "ra": 12.52, "dec": -57.11, "mag": 1.59},
    {"id": 84, "name_en": "Imai", "name_ja": "イマイ", "ra": 12.25, "dec": -58.75, "mag": 2.79}
]

# 星座を結ぶ線の定義
# 各要素は {"from": 星ID, "to": 星ID}
CONSTELLATION_LINES = [
    # オリオン座 (Orion)
    {"from": 8, "to": 21, "constellation": "Orion"},  # ベテルギウス - ベラトリックス
    {"from": 21, "to": 25, "constellation": "Orion"}, # ベラトリックス - ミンタカ
    {"from": 25, "to": 24, "constellation": "Orion"}, # ミンタカ - アルニラム
    {"from": 24, "to": 23, "constellation": "Orion"}, # アルニラム - アルニタク
    {"from": 23, "to": 8, "constellation": "Orion"},  # アルニタク - ベテルギウス
    {"from": 23, "to": 6, "constellation": "Orion"},  # アルニタク - リゲル
    {"from": 6, "to": 22, "constellation": "Orion"},  # リゲル - サイフ
    {"from": 22, "to": 25, "constellation": "Orion"}, # サイフ - ミンタカ

    # おおぐま座 (Ursa Major - 北斗七星)
    {"from": 31, "to": 32, "constellation": "Ursa Major"}, # ドゥーベ - メラク
    {"from": 32, "to": 33, "constellation": "Ursa Major"}, # メラク - フェクダ
    {"from": 33, "to": 34, "constellation": "Ursa Major"}, # フェクダ - メグレス
    {"from": 34, "to": 31, "constellation": "Ursa Major"}, # メグレス - ドゥーベ
    {"from": 34, "to": 35, "constellation": "Ursa Major"}, # メグレス - アリオト
    {"from": 35, "to": 36, "constellation": "Ursa Major"}, # アリオト - ミザール
    {"from": 36, "to": 37, "constellation": "Ursa Major"}, # ミザール - アルカイド

    # カシオペヤ座 (Cassiopeia)
    {"from": 42, "to": 41, "constellation": "Cassiopeia"}, # カフ - シェダル
    {"from": 41, "to": 43, "constellation": "Cassiopeia"}, # シェダル - ツィー
    {"from": 43, "to": 44, "constellation": "Cassiopeia"}, # ツィー - ルクバー
    {"from": 44, "to": 45, "constellation": "Cassiopeia"}, # ルクバー - セギン

    # はくちょう座 (Cygnus)
    {"from": 14, "to": 51, "constellation": "Cygnus"}, # デネブ - サドル
    {"from": 51, "to": 52, "constellation": "Cygnus"}, # サドル - アルビレオ
    {"from": 51, "to": 53, "constellation": "Cygnus"}, # サドル - ジェナー
    {"from": 51, "to": 54, "constellation": "Cygnus"}, # サドル - ファワリス

    # こと座 (Lyra)
    {"from": 4, "to": 63, "constellation": "Lyra"},  # ベガ - アラドファ
    {"from": 4, "to": 62, "constellation": "Lyra"},  # ベガ - シェリアク
    {"from": 62, "to": 61, "constellation": "Lyra"}, # シェリアク - スラファト
    {"from": 61, "to": 4, "constellation": "Lyra"},  # スラファト - ベガ

    # わし座 (Aquila)
    {"from": 9, "to": 71, "constellation": "Aquila"}, # アルタイル - アルシャイン
    {"from": 9, "to": 72, "constellation": "Aquila"}, # アルタイル - タラゼド

    # 南十字星 (Crux)
    {"from": 81, "to": 83, "constellation": "Crux"}, # アクルックス - ガクルックス (縦の軸)
    {"from": 82, "to": 84, "constellation": "Crux"}  # ミモザ - イマイ (横の軸)
]

# アステリズム（夏の大三角など、星座をまたぐ有名なアソシエーション）
# クライアントで星座線とは別カラーで描画できるように区別
ASTERISMS = [
    # 夏の大三角 (Summer Triangle)
    {"from": 4, "to": 14, "label": "Summer Triangle"}, # ベガ - デネブ
    {"from": 14, "to": 9, "label": "Summer Triangle"},  # デネブ - アルタイル
    {"from": 9, "to": 4, "label": "Summer Triangle"}    # アルタイル - ベガ
]
