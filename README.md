# はよ寝てやご飯やで

帰宅後の「ご飯」と「お風呂」をタイムアタック(RTA)にして、早く寝るためのPWAです。
[task_ver4](https://github.com/Yoshida256k/task_ver4) のLiveSplit風UIをWebに移植しています。

## 機能
- **帰宅 → START** を押すと計測開始。ご飯 → お風呂の順に「完了」を押すだけ
- LiveSplit風スプリット表(PB差・累積・区間ベストはゴールド表示)
- 目標時間を超えたら音とバイブで通知、画面は自動でスリープしない
- **就寝予想時刻**を常に表示(目標就寝に間に合うかを色で表示)
- ゴール後に「おやすみ」を押すと就寝時刻を記録
- **歴代タイムアタック**: 合計/ご飯/お風呂ごとのランキング、就寝時刻の推移グラフ、全記録の並べ替え
- ランク判定は task_ver4 と同じ基準(目標比 30%以上短縮でS、15%以上でA、短縮でB、それ以外C)
- 一時停止、リロードしてもラン継続、オフライン動作、JSONで書き出し/読み込み

記録はブラウザ(localStorage)に保存されます。機種変更の前には設定画面から書き出してください。

## スマホで使う
静的ファイルだけなので GitHub Pages などにそのまま置けます。

1. GitHub のリポジトリ → Settings → Pages → Branch に公開するブランチと `/ (root)` を選ぶ
2. 表示されたURLをスマホで開く
3. Android(Chrome): メニュー →「ホーム画面に追加」/ iPhone(Safari): 共有 →「ホーム画面に追加」

ローカルで試す場合: `python3 -m http.server` を実行して http://localhost:8000 を開く。

## ファイルを更新したとき
`sw.js` の `CACHE` のバージョン(`oyasumi-rta-v2`)を上げると、古いキャッシュが入れ替わります。

## Claude Code スキル
- `.claude/skills/progressive-web-app/` — [secondsky/claude-skills](https://github.com/secondsky/claude-skills) (MIT) の PWA スキル
