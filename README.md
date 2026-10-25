# 千手お手玉

落ちてくる布玉を、手に届く瞬間のタップで投げ返すスマホ向けブラウザゲームです。玉と腕が増え、観音の表情も少しずつ変わります。添付の「千手お手玉 ゲーム企画書」の初期プロトタイプ仕様に基づいています。

## 遊び方

- 縮む輪が手に重なる瞬間に、画面のどこでもタップします。
- 同時に2個なら2本指、3個なら3本指で同時にタップします。
- 8回投げ返すごとに球数が増えます。1個取り逃したら終了です。
- PCではスペースキーで1本指相当の操作ができます。複数指の操作はタッチ端末向けです。
- 一時停止ボタン、またはEscキーで中断できます。別タブ・別アプリへ移動した際も自動で停止します。

最高到達球数は、そのブラウザのlocalStorageに保存します。プライベートブラウズや保存制限がある環境では、記録が残らない場合があります。

リザルト画面でPNG画像を保存し、Xへ投稿できます。Xの投稿画面には文章・URL・ハッシュタグが入ります。画像は保存したPNGをご自身で添付してください。画像保存の場所や操作は端末によって異なります。

## ローカルで起動

Node.js 22以上を使います。パッケージのインストールは不要です。

```sh
npm start
```

`http://localhost:4173` を開きます。同じWi-Fiのスマホからは、PCのLAN IPアドレスを使って `http://192.168.x.x:4173` を開けます。OSのファイアウォールで接続を許可する必要がある場合があります。

```sh
npm test
```

判定幅、40msの同時入力、難易度の上昇、停止・再開、30/60fpsの安定性を検証します。

## GitHub Pagesで公開

1. GitHubで公開リポジトリ（例：`senju-otedama`）を新規作成します。
2. このフォルダーのファイルをリポジトリのルートへ配置し、`main` ブランチに保存します。`index.html` をサブフォルダーに入れないでください。
3. **Settings → Pages → Build and deployment → Source** を **Deploy from a branch** にします。
4. **Branch** を `main`、フォルダーを **/(root)** にして **Save** を押します。
5. 公開処理が完了したら、Pages画面に表示されるURLをスマホで開きます。

公開URLの形式は `https://<GitHubユーザー名>.github.io/<リポジトリ名>/` です。相対パスを使っているので、GitHub Pagesのサブパスでも動作します。ビルドや環境変数、サーバー、APIキーは不要です。

GitHub CLIで認証済みなら、次のコマンドでも新規公開できます（同名の既存リポジトリがない場合）。

```sh
gh auth login --hostname github.com --git-protocol https --web
git init -b main
git add index.html style.css app.js game.js renderer.js icon.svg .nojekyll README.md package.json .gitignore scripts tests
git commit -m "Add Senju Otedama mobile browser game"
gh repo create senju-otedama --public --source=. --remote=origin --push
gh api -X POST repos/{owner}/senju-otedama/pages -f "source[branch]=main" -f "source[path]=/"
```

設定については[GitHub公式ドキュメント](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)も参照できます。

## 構成

| ファイル | 役割 |
| --- | --- |
| `index.html` / `style.css` | 縦長UI、操作説明、リザルト |
| `app.js` | タッチ入力、画面遷移、記録、PNG保存、X Web Intent |
| `game.js` | フレームレートに依存しないゲーム進行・判定 |
| `renderer.js` | 観音、腕、布玉、予告輪、波紋のCanvas 2D描画 |
| `tests/game.test.js` | ゲームルールの自動テスト |
| `scripts/serve.mjs` | 開発用の軽量HTTPサーバー |

外部画像・音楽・広告・アクセス解析は使っていません。ネットワーク通信はゲーム配信と、ユーザーが選んだXの投稿画面への遷移のみです。観音の描画は穏やかな表情とコミカルな焦りに留めています。

判定幅は±145ms、同時入力の受付幅は40msです。7球から2指、12球から3指が登場します。初期調整値のため、iPhone/Android実機での2〜3指入力、OSのジェスチャー設定、Safari/Chromeでの遅延やPNG保存を確認して調整してください。
