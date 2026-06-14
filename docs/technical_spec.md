# Stellaris Planetarium - 詳細技術仕様書 (Technical Specification)

本ドキュメントは、**Stellaris Professional Interactive Planetarium** のコアシステムにおける天体計算アルゴリズム、スレッドアーキテクチャ、3D レンダリングパイプライン、および API 構造についての詳細な技術仕様を解説します。

---

## 1. 天体計算モデル (Astronomical Calculation)

本プロジェクトでは、外部の天文学ライブラリ（Astropy 等）に依存せず、Python バックエンドおよび WebWorker (TypeScript) 内で数式に基づいたフルスクラッチの天体計算を行います。

### 1.1 ユリウス日 (Julian Date: JD) の算出
時間経過に伴う天体位置の変化を連続的に扱うため、入力された UTC 時刻（グレゴリオ暦）をユリウス日へ変換します。

$$\text{JD} = \lfloor 365.25 \times (Y + 4716) \rfloor + \lfloor 30.6001 \times (M + 1) \rfloor + D + B - 1524.5$$

* **グレゴリオ暦補正因子 $B$**:
  $$A = \lfloor Y / 100 \rfloor$$
  $$B = 2 - A + \lfloor A / 4 \rfloor$$
* **注意点**: 1月および2月は前年の13月、14月として計算されます。

### 1.2 地方恒星時 (Local Sidereal Time: LST) の算出
観測地点の経度における天球の回転角を決定するため、平均グリニッジ恒星時 (GMST) を経由して LST を算出します（IAU 1982モデル準拠）。

1. J2000.0 からの経過ユリウス世紀数 $T$:
   $$T = \frac{\text{JD} - 2451545.0}{36525}$$
2. 平均グリニッジ恒星時 (GMST) の度数計算:
   $$\text{GMST (deg)} = 280.46061837 + 360.98564736629 \times (\text{JD} - 2451545.0) + 0.000387933 \times T^2 - \frac{T^3}{38710000.0}$$
3. 地方恒星時 (LST) への変換（観測経度 $\lambda$ 東経をプラスとする）:
   $$\text{LST (deg)} = (\text{GMST} + \lambda) \pmod{360}$$

### 1.3 赤道座標から地平座標への変換
恒星や天体のカタログ座標である赤経 ($\alpha$: RA, 時角換算)・赤緯 ($\delta$: Dec, 度数) を、観測地点における方位角 ($Az$)・高度 ($Alt$) に変換します。

1. **時角 (Hour Angle: HA)**:
   $$H = \text{LST} - (\alpha \times 15.0)$$
2. **高度 (Altitude: Alt)**:
   $$\sin(Alt) = \sin(\phi) \sin(\delta) + \cos(\phi) \cos(\delta) \cos(H)$$
   $$Alt = \arcsin(\sin(Alt))$$
   * $\phi$: 観測緯度 (Latitude)
3. **方位角 (Azimuth: Az)**:
   $$y = -\sin(H) \cos(\delta)$$
   $$x = \cos(\phi) \sin(\delta) - \sin(\phi) \cos(\delta) \cos(H)$$
   $$Az = \text{atan2}(y, x) \pmod{360}$$
   * 本システムの方位角定義は、**北を 0° とし、東を 90° (時計回り)** とします。

---

## 2. スレッド・並列化アーキテクチャ (Multi-threading with WebWorker)

毎フレーム数千個の恒星および星座線セグメントを再計算してリアルタイムに天球を回転させるため、本プロジェクトではメインの UI レンダリングスレッドの負荷を極限まで低減させるマルチスレッド構造を採用しています。

```mermaid
sequenceDiagram
    autonumber
    participant Main as メインスレッド (main.ts)
    participant Worker as WebWorker (star-worker.ts)
    participant API as FastAPI バックエンド

    Main->>API: HTTP Get /api/sky (緯度・経度)
    API-->>Main: 天体カタログデータ (RA/Dec/等級)
    Main->>Worker: postMessage (type: 'init', stars, constellations)
    Note over Worker: カタログデータをメモリにキャッシュ
    
    loop 毎フレーム (requestAnimationFrame)
        Note over Main: 時刻の更新 (Time Flow)
        Main->>Worker: postMessage (type: 'update', LST, Latitude)
        Note over Worker: 並列天体座標計算<br/>Float32Array バッファ書き込み
        Worker-->>Main: postMessage (type: 'result', coords, constellationCoords) <br/>※ゼロコピー転送 (Transferable Objects)
        Note over Main: Three.js Sprites 座標更新<br/>LineSegments 描画
        Main->>Main: composer.render() & Canvas 2D Overlay
    end
```

### 2.1 ゼロコピーデータ転送 (Transferable Objects)
スレッド間での配列コピーのオーバーヘッドを避けるため、計算された座標データは `Transferable Objects` として転送されます。
* `coords`: 恒星の `[x, y, z, visible]` を格納する `Float32Array`。
* `constellationCoords`: 描画対象の星座線の始点・終点 `[x1, y1, z1, x2, y2, z2]` を格納する `Float32Array`。

スレッド間でメモリバッファの所有権を移動させる（ゼロコピー）ため、毎フレーム 5,000 個以上の天体計算を行ってもガベージコレクション (GC) やメモリコピーに伴うフレームドロップ (Stuttering) が一切発生せず、快適な **60fps** レンダリングを達成しています。

---

## 3. 3D グラフィックス & レンダリング技術 (3D Graphics & Visuals)

Three.js をベースに、リアルさとサイバーパンク的なネオン調の高級感を融合させた独自のヴィジュアルシステムを構築しています。

### 3.1 恒星の描画と輝き (UnrealBloomPass)
* **スプレッドテクスチャ**: 恒星は `THREE.Sprite` を用い、B-V色指数からマッピングされた色彩（青白〜白〜オレンジ〜赤）の動的なグラデーションテクスチャを Canvas 上でプレジェネレートして貼り付けています。
* **ポストプロセッシング**: `EffectComposer` による Bloom (光彩) 処理（`UnrealBloomPass`）を適用。カメラの視野角（FOV）に合わせて Bloom 強度と閾値を動的に変化させています。
  * **望遠（ズームイン）時**: 閾値 (threshold) を引き上げ、一等星などの非常に明るい星だけを強く拡散発光させ、コントラストを高めます。
  * **広角（ズームアウト）時**: 閾値を下げ、天の川を含めた全体に淡いグロー感をまとわせます。
* **またたき (Twinkle) 効果**: 等級が 3.0 未満の明るい星に対し、サイン波と星固有の ID を組み合わせた微細なまたたきアニメーションを適用しています。

### 3.2 プロシージャル山並みシルエットとオクルージョン
画面最前面に立体感を与えるため、プロシージャルに生成されたローポリゴンの山並みを地平線沿いに配置しています。

* **幾何構造の生成**: 異なる周波数と振幅を持つ 5 つのサイン波を重畳させ、自然な山稜の凹凸を生成し、`THREE.BufferGeometry` で地面へ伸びるクワッドメッシュを構築しています。
* **3D オクルージョン**: この山並みは完全な黒（`0x000000`）かつ `depthWrite: true` / `depthTest: true` で描画されるため、山並みの後ろに沈む星や天の川が物理的に遮蔽され、圧倒的なパララックス（視差効果）による奥行き感が表現されます。
* **ネオンアウトライン**: 山の輪郭には鮮烈なネオンシアン（`0x00ffcc`）、側面にはディープブルー（`0x0f2d6b`）のワイヤーフレームを重ね、SF的なデザインとして仕上げています。

### 3.3 天の川の再現 (Milky Way Particles)
銀河面に沿って 8,000 個のパーティクルを配置した `THREE.Points` システムです。
* 銀河座標系（銀緯 $b = 0^\circ$ 付近、銀経 $l = 0 \sim 360^\circ$）における分布を乱数で作成し、銀河北極（RA=192.86°, Dec=27.13°）を基準とする座標変換行列を用いて赤道座標系（RA, Dec）に変換。
* 天球の最奥レイヤー（半径 900）に配置することで、背景として自然な天の川を演出します。

### 3.4 大気散乱リング (Atmospheric Scattering Simulation)
地平線付近に 2 つのトーラスメッシュ（`THREE.TorusGeometry`）を配置し、大気による光の散乱（大気光）を再現しています。
* 時間経過とともに大気リングの不透明度（`opacity`）を呼吸するように波打たせる（パルスアニメーション）ことで、静的な画面に「生きた動き」を付与しています。

---

## 4. API 仕様 (Backend Endpoints)

FastAPI で実装されたバックエンドは、精密計算用の天体データベースを提供します。

### 4.1 `GET /api/sky`
指定された観測地点と日時において観測可能な、すべての天体（恒星、星座線、惑星、DSO）の現在の地平座標・各種メタデータを一括して返します。

* **クエリパラメータ**:
  | パラメータ | 型 | デフォルト値 | 説明 |
  | :--- | :--- | :--- | :--- |
  | `lat` | float | `35.68` | 観測緯度（-90 ～ 90 度） |
  | `lng` | float | `139.76` | 観測経度（-180 ～ 180 度） |
  | `time` | string (ISO) | `None` | 観測日時。省略時はサーバーの現在時刻 (UTC) |
  | `mag_limit`| float | `6.0` | 描画する星の最大等級制限（暗い星のフィルタリング用） |

* **レスポンス (JSON概要)**:
  ```json
  {
    "datetime": "2026-06-14T05:00:00+00:00",
    "julian_date": 2461205.708333,
    "lst_deg": 185.3421,
    "stars": [
      {
        "id": 32349,
        "name_ja": "シリウス",
        "ra": 6.7525,
        "dec": -16.7161,
        "mag": -1.46,
        "bv": -0.03,
        "color": "#aabfff",
        "az": 210.4521,
        "alt": 12.3041
      }
    ],
    "constellation_lines": [
      {
        "cid": "CMa",
        "segments": [
          { "ra1": 6.75, "dec1": -16.7, "ra2": 6.97, "dec2": -24.0 }
        ]
      }
    ],
    "planets": [
      {
        "name": "Jupiter",
        "name_ja": "木星",
        "ra": 3.42,
        "dec": 18.5,
        "az": 85.12,
        "alt": 42.6,
        "color": "#ffedd5",
        "mag": -2.1,
        "dist_au": 5.2
      }
    ],
    "deep_sky_objects": [
      {
        "id": "M42",
        "name_ja": "オリオン大星雲",
        "name_en": "Orion Nebula",
        "type": "Emission Nebula",
        "size": 65,
        "mag": 4.0,
        "az": 225.1,
        "alt": 15.4
      }
    ]
  }
  ```

### 4.2 `GET /api/constellations`
全天 88 星座の解説や中心座標、見頃となる季節などのメタデータを取得します。

* **レスポンス (JSON概要)**:
  ```json
  {
    "constellations": {
      "Ori": {
        "name_ja": "オリオン座",
        "name_en": "Orion",
        "name_la": "Orion",
        "season": "冬",
        "desc": "天の赤道上に位置する、全天で最も華やかで有名な星座...",
        "center_ra": 5.5,
        "center_dec": 5.0,
        "rank": 1
      }
    }
  }
  ```

### 4.3 `GET /api/sky/stars-only`
初期ローディング時やアニメーション時のフレームレート維持などの目的で使用される、明るい星（デフォルトで 4 等星以下）のみを高速に取得するための軽量エンドポイントです。

---

## 5. 開発者向けトラブルシューティング

### 5.1 「Port already in use」による起動失敗
バックエンド（8000番ポート）またはフロントエンド（3000番ポート）の起動時に、過去のプロセスがゾンビプロセスとしてポートを占有し続けるケースがあります。

* **ポートの占有プロセスの特定と強制終了 (Windows PowerShell)**:
  ```powershell
  # 8000番ポートを占有しているPIDの調査
  netstat -ano | findstr 8000
  
  # 特定したPID（例: 12345）の強制終了
  taskkill /F /PID 12345
  ```
