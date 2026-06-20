/// <reference types="vite/client" />

// プロジェクト固有の環境変数の型定義
interface ImportMetaEnv {
  /** バックエンド API のベース URL (例: http://localhost:8000) */
  readonly VITE_API_BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
