# -*- coding: utf-8 -*-
"""
# astro_loader.py
# astro_data.json を一度だけロードするユーティリティ (Updated to clear cache)
# インターネットから取得済みの天体データを提供する
"""

import json
import os
from functools import lru_cache

_DATA_PATH = os.path.join(os.path.dirname(__file__), '..', 'front', 'public', 'astro_data.json')

@lru_cache(maxsize=1)
def load_astro_data() -> dict:
    """astro_data.jsonを一度だけロードしてキャッシュする"""
    with open(_DATA_PATH, 'r', encoding='utf-8') as f:
        return json.load(f)

def get_stars() -> list:
    """
    星カタログを返す
    各星: {'h': HIP番号, 'm': 等級, 'b': B-V色指数, 'r': 赤経(時間), 'd': 赤緯(度)}
    """
    data = load_astro_data()
    return data['stars']

def get_constellation_lines() -> dict:
    """
    星座線辞書を返す
    {cid: [[ra1, dec1, ra2, dec2], ...], ...}
    """
    data = load_astro_data()
    return data['lines']

def get_constellation_meta() -> dict:
    """
    星座メタデータ辞書を返す
    {cid: {name_ja, name_en, name_la, season, desc, center_ra, center_dec, rank}, ...}
    """
    data = load_astro_data()
    return data['meta']

def get_constellation_bounds() -> dict:
    """
    星座境界ポリゴン辞書を返す
    {cid: [[ra, dec], ...], ...}
    """
    data = load_astro_data()
    return data['bounds']
