#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
"""
天体データジェネレーター
d3-celestial (https://github.com/ofrohn/d3-celestial) から以下のデータを取得・変換する:
  - 恒星カタログ (HIPparcos, 6等星以下, ~5000星)
  - 88星座の星座線データ
  - 88星座のメタデータ (名称・説明)
  - IAU正式星座境界データ

出力: front/public/astro_data.json
"""

import json
import urllib.request
import ssl
import os
import sys

BASE_URL = "https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data"

def fetch_json(url):
    """URLからJSONをフェッチする"""
    print(f"  取得中: {url}")
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Python/3.x astro-data-gen'})
        ssl_ctx = ssl.create_default_context()  # V-7: SSL証明書検証を明示化
        with urllib.request.urlopen(req, timeout=30, context=ssl_ctx) as response:
            data = response.read().decode('utf-8')
            return json.loads(data)
    except Exception as e:
        print(f"  エラー: {e}", file=sys.stderr)
        sys.exit(1)

def normalize_ra(ra_d3: float) -> float:
    """
    d3-celestialのRA座標(度数, 負の値あり) → RA時間(0-24h)に変換
    d3-celestial RA: 0-180° (0h-12h), 負 (12h-24h)
    """
    ra_deg = ((ra_d3 % 360.0) + 360.0) % 360.0
    return round(ra_deg / 15.0, 5)

# ============================
# 季節マッピング
# ============================
SEASONS = {
    # 冬 (12-2月に南中)
    'Ori': 'winter', 'Tau': 'winter', 'Gem': 'winter', 'Aur': 'winter',
    'CMa': 'winter', 'CMi': 'winter', 'Lep': 'winter', 'Eri': 'winter',
    'Mon': 'winter', 'Col': 'winter', 'Pic': 'winter', 'Cae': 'winter',
    'Ret': 'winter', 'Dor': 'winter', 'Cma': 'winter',
    # 春 (3-5月に南中)
    'Leo': 'spring', 'Vir': 'spring', 'Hya': 'spring', 'Boo': 'spring',
    'Crv': 'spring', 'Cnc': 'spring', 'Com': 'spring', 'CVn': 'spring',
    'Crt': 'spring', 'LMi': 'spring', 'Sex': 'spring', 'UMa': 'spring',
    'UMi': 'spring', 'Leo': 'spring', 'Hya': 'spring', 'Ant': 'spring',
    'Pyx': 'spring', 'Vel': 'spring', 'Cen': 'spring',
    # 夏 (6-8月に南中)
    'Sco': 'summer', 'Sgr': 'summer', 'Aql': 'summer', 'Cyg': 'summer',
    'Lyr': 'summer', 'Her': 'summer', 'Oph': 'summer', 'Ser': 'summer',
    'CrB': 'summer', 'Vul': 'summer', 'Del': 'summer', 'Sge': 'summer',
    'Sct': 'summer', 'Ara': 'summer', 'CrA': 'summer', 'Lup': 'summer',
    'Tel': 'summer', 'Pav': 'summer', 'Nor': 'summer', 'Sco': 'summer',
    'Lib': 'summer',
    # 秋 (9-11月に南中)
    'Peg': 'autumn', 'And': 'autumn', 'Per': 'autumn', 'Ari': 'autumn',
    'Psc': 'autumn', 'Aqr': 'autumn', 'Cas': 'autumn', 'Cep': 'autumn',
    'Cet': 'autumn', 'PsA': 'autumn', 'Lac': 'autumn', 'Tri': 'autumn',
    'Phe': 'autumn', 'Scl': 'autumn', 'For': 'autumn', 'Eri': 'autumn',
    'Cap': 'autumn',
}

# ============================
# 主要星座の日本語説明
# ============================
DESCRIPTIONS = {
    'Ori': 'オリオン座は冬の夜空を代表する最も華やかな星座。赤色超巨星ベテルギウスと青白色超巨星リゲルという対照的な一等星を持ち、三つ星（オリオンのベルト）が目印。ギリシャ神話では巨人の狩人オリオンを表す。',
    'UMa': '北斗七星を含む春の星座。北極星を見つける道標として古くから親しまれてきた。ギリシャ神話では女神ヘラによって熊に変えられたカリストを表す。面積は全天で3番目に大きい。',
    'UMi': '北極星ポラリスを含む星座。小熊の尻尾の先に北極星があり、北を知る基準として航海者に利用されてきた。プレセッション（歳差）により、今から約12,000年後はベガが北極星になる。',
    'Cas': '秋から冬の北の空、W字形に輝く星座。北極星を挟んで北斗七星の反対側にあり、一年中北の空で見られる。ギリシャ神話のエチオピアの女王カシオペアを表す。',
    'Per': '秋から冬の北の空にある星座。変光星アルゴル（悪魔の目）を含む。ギリシャ神話の英雄ペルセウスを表し、毎年8月にはペルセウス座流星群が見られる。',
    'And': 'アンドロメダ銀河(M31)を含む秋の星座。M31は肉眼で見える最遠の天体（250万光年）。ギリシャ神話のアンドロメダ姫を表す。ペガスス四辺形の東に連なる。',
    'Peg': '秋の目印「ペガスス四辺形」が目印の大きな星座。四辺形の一角アルフェラッツはアンドロメダ座と共有。ギリシャ神話の天馬ペガサスを表す。',
    'Cep': '北の空に一年中見える星座。不規則変光星でこの種の変光星の代表格δ（デルタ）星を含む。ギリシャ神話のエチオピア王ケフェウスを表す。',
    'Tau': '冬の空。一等星アルデバランを含み、有名なプレアデス星団（昴/すばる）とヒアデス星団もある。4500年前から農耕暦の基準として使われた由緒ある星座。',
    'Gem': '冬の空の双子座。双子の兄弟カストルとポルックスが隣り合う明るい星。ポルックスが一等星で、カストルは二等星。夏至点がかつてこの星座にあったため「夏至星座」とも呼ばれた。',
    'Aur': '冬の北の空。一等星カペラ（山羊座の意）を中心とした五角形が目印。ガリレオが1609年に発見した星雲状天体が多く含まれる。ギリシャ神話の馬車乗り。',
    'Leo': '春の空に輝く黄道十二星座の一つ。一等星レグルスを先頭に逆クエスチョンマーク状に並ぶ「ライオンの鎌」が特徴。古代エジプトでは春分の基準として崇められた。',
    'Vir': '春の黄道十二星座。一等星スピカ（麦の穂）を含む。「春の大曲線（アークトゥルス→スピカ）」の目印。太陽系外惑星が多く発見されている星座でもある。',
    'Boo': '春の明るい一等星アルクトゥルスを含む。アルクトゥルスは北半球の空で最も明るい星（シリウスは南天）。ギリシャ神話の牛飼いアルクトゥルスに由来。',
    'Sco': '夏の南の空。赤色超巨星アンタレス（火星の敵手）を中心に多くの明るい星が並ぶ。さそりの形がよくわかる美しい星座。オリオン座とは天球の反対側にあり「共存できない」という神話がある。',
    'Sgr': '夏の黄道十二星座。天の川銀河の中心方向にある。「南斗六星」とティーポット型の星並びが特徴。多くの星雲・星団（M8干潟星雲、M20三裂星雲など）を含む。',
    'Cyg': '夏の天の川沿いにある星座。デネブ・アルビレオが結ぶ「北十字」として知られる。夏の大三角（デネブ・ベガ・アルタイル）の一角。天の川を横断するように広がる。',
    'Lyr': '夏の小さな星座。全天第5位の明るさの青白い一等星ベガを含む。夏の大三角の一角。ベガは織女星（七夕の織姫）。環状星雲(M57)が有名。ギリシャ神話の音楽家オルフェウスの竪琴。',
    'Aql': '夏の天の川沿いの星座。一等星アルタイル（彦星、七夕の牛飼い）を含む。夏の大三角の一角。天の川を挟んでこと座のベガと向かい合う。',
    'Her': '夏の大きな星座。明るい星は少ないが全天で5番目に大きい。球状星団M13（ヘルクレス大球状星団）が有名で肉眼でも見える。ギリシャ神話の英雄ヘラクレスを表す。',
    'Oph': '夏の大きな星座。へびつかい（医師アスクレピオス）が蛇を持つ姿を表す。事実上黄道（太陽の通り道）を通る13番目の星座だが黄道十二星座に含まれていない。',
    'CMa': '冬の星座。全天で最も明るい星シリウス（-1.46等）を含む。シリウスが太陽とともに昇る日（ヘリアカル・ライジング）が古代エジプトのナイル川氾濫の始まりとされた。',
    'CMi': '冬の小さな星座。一等星プロキオン（犬の前を行く者）を含む冬の大三角の一角。',
    'Aries': '秋の黄道十二星座。羊の星座。紀元前の春分点がこの星座にあったため、黄道の基点として重要。現在の春分点はうお座に移っている。',
    'Ari': '秋の黄道十二星座。黄道の基点となる春分点がかつて（紀元前1000年ごろ）この星座にあった。羊の角を表す3つの星が目印。',
    'Tau': '冬の黄道十二星座。一等星アルデバランと有名な散開星団「昴（すばる/プレアデス）」を含む。牛の顔と角を表す星の配置が特徴。',
    'Cnc': '春の黄道十二星座。明るい星は少ないが、散開星団プレセペ（M44、蜂の巣星団）を含む。古代にはこの星座に夏至点があった。',
    'Lib': '夏の黄道十二星座。てんびん座。古代には乙女座（ヴィルゴ）の爪（アストラエアのはかり）だった。',
    'Cap': '秋の黄道十二星座。やぎ座。山羊と魚が合体した「海の山羊」を表す。かつてここに冬至点があった。',
    'Aqr': '秋の黄道十二星座。みずがめ座。水瓶から水を注ぐ男の姿を表す。有名な球状星団M2を含む。',
    'Psc': '秋の黄道十二星座。うお座。現在の春分点がこの星座にある（2597年ごろまで）。二匹の魚を表す。',
    'Cen': '南天の大星座。半人馬ケンタウロスを表す。α星は太陽から最も近い恒星系（4.24光年）。南半球では目立つ星座で南十字星のそばにある。',
    'Car': 'かつてアルゴ船座の一部。全天第2位の明るさの星カノープスを含む。全天で2番目に大きい星座。',
    'Cru': '南十字星として有名な南天最小の星座だが最も密度が高い。4つの明るい星が十字を形成し、南極点への方向の目印。オーストラリアや南アフリカなどの国旗にも描かれる。',
    'Hya': '全88星座中で最大の面積を持つ星座（全天の3.16%）。一等星アルファルドを含む。海蛇を表す。春の南の空に長く伸びる。',
    'Vul': '夏の小さな星座。こぎつね座。有名な惑星状星雲「あれい星雲(M27)」を含む。',
    'Del': '夏の小さな星座。いるか座。ひし形とその外の一点で作られる形が愛らしい。',
    'CrB': '夏の小さな星座。かんむり座。7つの星が弧を描く美しい星座。ギリシャ神話でアリアドネのティアラを表す。',
    'Oph': 'へびつかい座。夏の大きな星座で事実上の黄道星座の13番目。医師アスクレピオスを表す。',
    'Ser': 'へび座。へびつかい座に分断されて「頭部」と「尾部」に分かれる唯一の星座。',
    'Cet': '秋の大きな星座。くじら座。有名な変光星ミラ（o Cet）を含む。',
}

def get_description(cid, name_ja, name_en):
    """星座の説明を取得"""
    if cid in DESCRIPTIONS:
        return DESCRIPTIONS[cid]
    # デフォルト説明
    return f'{name_ja}（{name_en}）は国際天文学連合（IAU）が定めた88星座の一つ。'

def main():
    print("=" * 60)
    print("Stellaris 天体データ生成")
    print("=" * 60)

    # データ取得
    print("\n[1/4] 星座メタデータ取得中...")
    meta_data = fetch_json(f"{BASE_URL}/constellations.json")

    print("\n[2/4] 星座線データ取得中...")
    lines_data = fetch_json(f"{BASE_URL}/constellations.lines.json")

    print("\n[3/4] 星座境界データ取得中...")
    bounds_data = fetch_json(f"{BASE_URL}/constellations.bounds.json")

    print("\n[4/4] 恒星カタログ (6等星以下) 取得中...")
    stars_data = fetch_json(f"{BASE_URL}/stars.6.json")

    # ==========================================
    # メタデータ処理
    # ==========================================
    print("\n処理中: 星座メタデータ...")
    meta = {}
    for feature in meta_data['features']:
        cid = feature['id']
        props = feature['properties']
        center = feature['geometry']['coordinates']

        name_ja = props.get('ja', cid)
        name_en = props.get('en', '')
        name_la = props.get('la', props.get('name', cid))

        meta[cid] = {
            'name_la': name_la,
            'name_en': name_en,
            'name_ja': name_ja,
            'rank': int(props.get('rank', '3')),
            'desig': props.get('desig', cid),
            'gen': props.get('gen', ''),
            'center_ra': normalize_ra(center[0]),
            'center_dec': round(float(center[1]), 4),
            'season': SEASONS.get(cid, 'all'),
            'desc': get_description(cid, name_ja, name_en),
        }

    # ==========================================
    # 星座線処理
    # ==========================================
    print("処理中: 星座線データ...")
    lines = {}
    total_segments = 0
    for feature in lines_data['features']:
        cid = feature['id']
        segments = []
        geom_type = feature['geometry']['type']
        if geom_type == 'MultiLineString':
            polylines = feature['geometry']['coordinates']
        else:
            polylines = [feature['geometry']['coordinates']]

        for polyline in polylines:
            for i in range(len(polyline) - 1):
                p1 = polyline[i]
                p2 = polyline[i+1]
                ra1 = normalize_ra(p1[0])
                dec1 = round(float(p1[1]), 4)
                ra2 = normalize_ra(p2[0])
                dec2 = round(float(p2[1]), 4)
                segments.append([ra1, dec1, ra2, dec2])
        lines[cid] = segments
        total_segments += len(segments)

    # ==========================================
    # 星座境界処理 (ポリゴン → ラインセグメント)
    # ==========================================
    print("処理中: 星座境界データ...")
    bounds = {}
    for feature in bounds_data['features']:
        cid = feature['id']
        geom_type = feature['geometry']['type']
        if geom_type == 'Polygon':
            ring = feature['geometry']['coordinates'][0]
        elif geom_type == 'MultiPolygon':
            # 最初のポリゴンだけ使う
            ring = feature['geometry']['coordinates'][0][0]
        else:
            continue

        points = []
        for coord in ring:
            ra = normalize_ra(coord[0])
            dec = round(float(coord[1]), 4)
            points.append([ra, dec])
        # 閉じた境界線のセグメントとして格納
        bounds[cid] = points

    # ==========================================
    # 恒星カタログ処理
    # ==========================================
    print("処理中: 恒星カタログ...")
    stars = []
    uma_stars = {}
    for feature in stars_data['features']:
        hip = feature['id']
        props = feature['properties']
        coords = feature['geometry']['coordinates']
        mag = props['mag']

        bv_raw = props.get('bv', '0.6')
        try:
            bv = float(bv_raw) if bv_raw is not None else 0.6
        except (ValueError, TypeError):
            bv = 0.6

        ra = normalize_ra(coords[0])
        dec = round(float(coords[1]), 4)

        if hip in [67301, 65378, 62956, 59774, 54061, 53910, 58001,
                   46733, 48402, 47006, 41704, 42527, 44390, 45038,
                   44127, 48319, 46853, 44248, 57399, 50372, 50801,
                   55219, 55203, 54539]:
            uma_stars[hip] = (ra, dec)

        # 短縮キー名でファイルサイズを削減
        stars.append({
            'h': hip,          # HIP番号
            'm': mag,          # 等級
            'b': round(bv, 3), # B-V色指数
            'r': ra,           # 赤経 (時間)
            'd': dec,          # 赤緯 (度)
        })

    # ==========================================
    # UMa (おおぐま座) の星座線を手動で上書き
    # ==========================================
    uma_connections = [
        # 北斗七星（胴体と尻尾）
        (67301, 65378), # Alkaid - Mizar
        (65378, 62956), # Mizar - Alioth
        (62956, 59774), # Alioth - Megrez
        (59774, 58001), # Megrez - Phecda
        (58001, 53910), # Phecda - Merak
        (53910, 54061), # Merak - Dubhe
        (54061, 59774), # Dubhe - Megrez
        
        # 首から頭へ
        (54061, 46733), # Dubhe - 23 UMa
        (46733, 41704), # 23 UMa - Omicron
        (41704, 42527), # Omicron - Pi 2
        (42527, 44390), # Pi 2 - Rho
        (44390, 45038), # Rho - Sigma 2
        (45038, 46733), # Sigma 2 - 23 UMa
        
        # 首（23 UMa）から前足1へ
        (46733, 48319), # 23 UMa - Theta
        (48319, 46853), # Theta - Iota
        (46853, 44248), # Iota - Kappa
        
        # 首（23 UMa）から前足2へ
        (46733, 48402), # 23 UMa - Upsilon
        (48402, 47006), # Upsilon - Phi
        
        # 胴体後部（Phecda）から後足へ
        (58001, 57399), # Phecda - Chi
        # 後足1
        (57399, 50372), # Chi - Psi
        (50372, 50801), # Psi - Mu
        # 後足2
        (57399, 55219), # Chi - Nu
        (55219, 55203), # Nu - Xi
    ]
    
    uma_segments = []
    for h1, h2 in uma_connections:
        if h1 in uma_stars and h2 in uma_stars:
            r1, d1 = uma_stars[h1]
            r2, d2 = uma_stars[h2]
            uma_segments.append([r1, d1, r2, d2])
            
    if uma_segments:
        lines['UMa'] = uma_segments
        print(f"  おおぐま座(UMa)の星座線を再構築しました (セグメント数: {len(uma_segments)})")

    # やまねこ座 (Lyn) がおおぐま座の足 (Kappa UMa: RA~9.01, Dec~41.78) に誤接続しているのを削除
    if 'Lyn' in lines:
        lyn_segments = []
        for seg in lines['Lyn']:
            if (abs(seg[0] - 9.01) < 0.02 and abs(seg[1] - 41.78) < 0.02) or \
               (abs(seg[2] - 9.01) < 0.02 and abs(seg[3] - 41.78) < 0.02):
                continue
            lyn_segments.append(seg)
        lines['Lyn'] = lyn_segments
        print("  やまねこ座(Lyn)の誤った線を削除しました")

    # ==========================================
    # 出力
    # ==========================================
    output = {
        'meta': meta,
        'lines': lines,
        'bounds': bounds,
        'stars': stars,
    }

    out_dir = os.path.join(os.path.dirname(__file__), '..', 'front', 'public')
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, 'astro_data.json')

    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, separators=(',', ':'))

    file_size_kb = os.path.getsize(out_path) / 1024
    print(f"\n{'=' * 60}")
    print(f"✓ 生成完了!")
    print(f"  出力: {os.path.abspath(out_path)}")
    print(f"  サイズ: {file_size_kb:.1f} KB")
    print(f"  星座数: {len(meta)}")
    print(f"  星座線 セグメント総数: {total_segments}")
    print(f"  星座境界 ポリゴン数: {len(bounds)}")
    print(f"  恒星数: {len(stars)}")
    print(f"{'=' * 60}")

if __name__ == '__main__':
    main()
