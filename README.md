# c-send.pwa

c-send の現行PWAソースコードです。

- 配信対象: `pwa/`
- 現行バージョン: `0.1.84`
- 配信先: `https://narusue.github.io/c-send.pwa/`

このリポジトリは、c-send の静的PWAです。認証API、ポータル、データベースのコードは本リポジトリには含めません。

## 開発用の確認

`pwa/` を静的ファイルとして配信してください。Service Workerを使用するため、`file://` ではなくHTTP(S)で確認します。
