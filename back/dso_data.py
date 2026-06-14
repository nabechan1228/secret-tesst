# -*- coding: utf-8 -*-
"""
dso_data.py
メシエカタログ主要天体データ (Deep Sky Objects)

外部の dso_data.json からデータを動的にロードします。
"""

import os
import json

# JSONファイルのパスを取得（同ディレクトリ内の dso_data.json）
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
JSON_PATH = os.path.join(BASE_DIR, "dso_data.json")

try:
    with open(JSON_PATH, "r", encoding="utf-8") as f:
        MESSIER_OBJECTS = json.load(f)
except Exception as e:
    import sys
    print(f"Error loading dso_data.json: {e}", file=sys.stderr)
    MESSIER_OBJECTS = []

