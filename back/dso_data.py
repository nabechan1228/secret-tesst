# -*- coding: utf-8 -*-
"""
dso_data.py
メシエカタログ主要天体データ (Deep Sky Objects)

赤経 (ra): 時間単位 (0〜24)
赤緯 (dec): 度単位 (-90〜90)
size: 視直径（分角）
mag: 等級
type: nebula / galaxy / cluster / supernova_remnant
"""

MESSIER_OBJECTS = [
    # ============ 星雲 (Nebula) ============
    {
        "id": "M1",
        "name_ja": "かに星雲",
        "name_en": "Crab Nebula",
        "ra": 5.5753, "dec": 22.0145,
        "type": "supernova_remnant",
        "size": 7.0, "mag": 8.4,
        "constellation": "Tau"
    },
    {
        "id": "M8",
        "name_ja": "干潟星雲",
        "name_en": "Lagoon Nebula",
        "ra": 18.0639, "dec": -24.3833,
        "type": "nebula",
        "size": 60.0, "mag": 5.8,
        "constellation": "Sgr"
    },
    {
        "id": "M16",
        "name_ja": "わし星雲",
        "name_en": "Eagle Nebula",
        "ra": 18.3133, "dec": -13.7833,
        "type": "nebula",
        "size": 7.0, "mag": 6.0,
        "constellation": "Ser"
    },
    {
        "id": "M17",
        "name_ja": "オメガ星雲",
        "name_en": "Omega Nebula",
        "ra": 18.3456, "dec": -16.1833,
        "type": "nebula",
        "size": 20.0, "mag": 6.0,
        "constellation": "Sgr"
    },
    {
        "id": "M20",
        "name_ja": "三裂星雲",
        "name_en": "Trifid Nebula",
        "ra": 18.0428, "dec": -23.0333,
        "type": "nebula",
        "size": 28.0, "mag": 6.3,
        "constellation": "Sgr"
    },
    {
        "id": "M27",
        "name_ja": "亜鈴状星雲",
        "name_en": "Dumbbell Nebula",
        "ra": 19.9939, "dec": 22.7167,
        "type": "nebula",
        "size": 8.0, "mag": 7.4,
        "constellation": "Vul"
    },
    {
        "id": "M42",
        "name_ja": "オリオン大星雲",
        "name_en": "Orion Nebula",
        "ra": 5.5883, "dec": -5.3900,
        "type": "nebula",
        "size": 65.0, "mag": 4.0,
        "constellation": "Ori"
    },
    {
        "id": "M43",
        "name_ja": "デメランの星雲",
        "name_en": "De Mairan's Nebula",
        "ra": 5.5939, "dec": -5.2667,
        "type": "nebula",
        "size": 20.0, "mag": 9.0,
        "constellation": "Ori"
    },
    {
        "id": "M57",
        "name_ja": "リング星雲",
        "name_en": "Ring Nebula",
        "ra": 18.8936, "dec": 33.0333,
        "type": "nebula",
        "size": 1.4, "mag": 8.8,
        "constellation": "Lyr"
    },
    {
        "id": "M76",
        "name_ja": "小亜鈴状星雲",
        "name_en": "Little Dumbbell Nebula",
        "ra": 1.7044, "dec": 51.5750,
        "type": "nebula",
        "size": 2.7, "mag": 10.1,
        "constellation": "Per"
    },
    {
        "id": "M97",
        "name_ja": "ふくろう星雲",
        "name_en": "Owl Nebula",
        "ra": 11.2478, "dec": 55.0167,
        "type": "nebula",
        "size": 3.4, "mag": 9.9,
        "constellation": "UMa"
    },

    # ============ 銀河 (Galaxy) ============
    {
        "id": "M31",
        "name_ja": "アンドロメダ銀河",
        "name_en": "Andromeda Galaxy",
        "ra": 0.7122, "dec": 41.2692,
        "type": "galaxy",
        "size": 178.0, "mag": 3.4,
        "constellation": "And"
    },
    {
        "id": "M32",
        "name_ja": "M32銀河",
        "name_en": "M32",
        "ra": 0.7114, "dec": 40.8667,
        "type": "galaxy",
        "size": 8.7, "mag": 8.7,
        "constellation": "And"
    },
    {
        "id": "M33",
        "name_ja": "さんかく座銀河",
        "name_en": "Triangulum Galaxy",
        "ra": 1.5639, "dec": 30.6600,
        "type": "galaxy",
        "size": 67.0, "mag": 5.7,
        "constellation": "Tri"
    },
    {
        "id": "M51",
        "name_ja": "子持ち銀河",
        "name_en": "Whirlpool Galaxy",
        "ra": 13.4978, "dec": 47.1950,
        "type": "galaxy",
        "size": 11.0, "mag": 8.4,
        "constellation": "CVn"
    },
    {
        "id": "M63",
        "name_ja": "ひまわり銀河",
        "name_en": "Sunflower Galaxy",
        "ra": 13.2644, "dec": 42.0333,
        "type": "galaxy",
        "size": 12.6, "mag": 8.6,
        "constellation": "CVn"
    },
    {
        "id": "M64",
        "name_ja": "黒眼銀河",
        "name_en": "Black Eye Galaxy",
        "ra": 12.9456, "dec": 21.6833,
        "type": "galaxy",
        "size": 10.0, "mag": 8.5,
        "constellation": "Com"
    },
    {
        "id": "M81",
        "name_ja": "ボーデの銀河",
        "name_en": "Bode's Galaxy",
        "ra": 9.9258, "dec": 69.0650,
        "type": "galaxy",
        "size": 26.9, "mag": 6.9,
        "constellation": "UMa"
    },
    {
        "id": "M82",
        "name_ja": "葉巻銀河",
        "name_en": "Cigar Galaxy",
        "ra": 9.9283, "dec": 69.6800,
        "type": "galaxy",
        "size": 11.2, "mag": 8.4,
        "constellation": "UMa"
    },
    {
        "id": "M101",
        "name_ja": "風車銀河",
        "name_en": "Pinwheel Galaxy",
        "ra": 14.0533, "dec": 54.3500,
        "type": "galaxy",
        "size": 28.8, "mag": 7.9,
        "constellation": "UMa"
    },
    {
        "id": "M104",
        "name_ja": "ソンブレロ銀河",
        "name_en": "Sombrero Galaxy",
        "ra": 12.6661, "dec": -11.6233,
        "type": "galaxy",
        "size": 8.7, "mag": 8.0,
        "constellation": "Vir"
    },
    {
        "id": "M106",
        "name_ja": "M106銀河",
        "name_en": "M106",
        "ra": 12.3164, "dec": 47.3050,
        "type": "galaxy",
        "size": 18.0, "mag": 8.4,
        "constellation": "CVn"
    },

    # ============ 球状星団 (Globular Cluster) ============
    {
        "id": "M2",
        "name_ja": "M2球状星団",
        "name_en": "M2",
        "ra": 21.5583, "dec": -0.8233,
        "type": "cluster",
        "size": 12.9, "mag": 6.5,
        "constellation": "Aqr"
    },
    {
        "id": "M3",
        "name_ja": "M3球状星団",
        "name_en": "M3",
        "ra": 13.7031, "dec": 28.3767,
        "type": "cluster",
        "size": 16.2, "mag": 6.2,
        "constellation": "CVn"
    },
    {
        "id": "M4",
        "name_ja": "M4球状星団",
        "name_en": "M4",
        "ra": 16.3933, "dec": -26.5250,
        "type": "cluster",
        "size": 26.3, "mag": 5.6,
        "constellation": "Sco"
    },
    {
        "id": "M5",
        "name_ja": "M5球状星団",
        "name_en": "M5",
        "ra": 15.3094, "dec": 2.0817,
        "type": "cluster",
        "size": 17.4, "mag": 5.6,
        "constellation": "Ser"
    },
    {
        "id": "M13",
        "name_ja": "ヘルクレス球状星団",
        "name_en": "Hercules Cluster",
        "ra": 16.6950, "dec": 36.4600,
        "type": "cluster",
        "size": 16.6, "mag": 5.8,
        "constellation": "Her"
    },
    {
        "id": "M22",
        "name_ja": "いて座球状星団",
        "name_en": "Sagittarius Cluster",
        "ra": 18.6061, "dec": -23.9050,
        "type": "cluster",
        "size": 24.0, "mag": 5.1,
        "constellation": "Sgr"
    },

    # ============ 散開星団 (Open Cluster) ============
    {
        "id": "M44",
        "name_ja": "プレセペ星団",
        "name_en": "Beehive Cluster",
        "ra": 8.6717, "dec": 19.9833,
        "type": "open_cluster",
        "size": 70.0, "mag": 3.1,
        "constellation": "Cnc"
    },
    {
        "id": "M45",
        "name_ja": "プレアデス星団（すばる）",
        "name_en": "Pleiades",
        "ra": 3.7883, "dec": 24.1167,
        "type": "open_cluster",
        "size": 110.0, "mag": 1.6,
        "constellation": "Tau"
    },
    {
        "id": "M67",
        "name_ja": "M67散開星団",
        "name_en": "M67",
        "ra": 8.8550, "dec": 11.8167,
        "type": "open_cluster",
        "size": 30.0, "mag": 6.9,
        "constellation": "Cnc"
    },
]
