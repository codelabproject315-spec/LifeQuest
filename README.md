# LifeQuest 🗺️
現実世界を冒険フィールドに。1日6回ランダムなタイミングでクエストが届き、5分以内にクリアせよ！

## セットアップ手順

### 1. リポジトリをクローン
```bash
git clone https://github.com/あなたのユーザー名/lifequest.git
cd lifequest
npm install
```

### 2. 環境変数を設定
```bash
cp .env.example .env
```
`.env`を開いて各値を入力してください。

#### Firebase設定値の取得
1. [Firebaseコンソール](https://console.firebase.google.com) を開く
2. プロジェクト設定 → 全般 → マイアプリ → CDN の設定値をコピー

#### VAPID Keyの取得
1. Firebaseコンソール → プロジェクト設定 → Cloud Messaging
2. 「ウェブプッシュ証明書」→「鍵ペアを生成」→ キーをコピー

#### Firebase Admin（サービスアカウント）の取得
1. Firebaseコンソール → プロジェクト設定 → サービスアカウント
2. 「新しい秘密鍵を生成」→ JSONをダウンロード
3. `project_id`, `client_email`, `private_key` を`.env`にコピー

### 3. ローカルで起動
```bash
npm run dev
```

### 4. Vercelにデプロイ

1. [Vercel](https://vercel.com) にアクセス
2. 「New Project」→ GitHubリポジトリを選択
3. Environment Variables に`.env`の内容をすべて入力
4. Deploy！

### 5. Firebase Hosting の設定（通知用）
Firebaseコンソール → Hosting → カスタムドメインにVercelのURLを登録

## 技術スタック
- React + Vite + Tailwind CSS
- Firebase (Auth / Firestore / FCM)
- Vercel (Hosting / Serverless Functions / Cron Jobs)
