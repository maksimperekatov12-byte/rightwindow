# Apple Wallet pass — что нужно сделать один раз

Весь код готов: генерация пасса (`/api/pass`), веб-сервис регистраций (`/api/pk/v1/...`,
хранилище — Vercel Blob), APNs-пуш после каждого часового обновления данных
(`scripts/push-passes.mjs`, шаг в refresh-workflow). Осталось получить у Apple три вещи.

## 0. Apple Developer Program
$99/год: https://developer.apple.com/programs/enroll/ (Apple ID + оплата, активация до 48ч).

## 1. Pass Type ID + сертификат (портал → Certificates, IDs & Profiles)
1. Identifiers → «+» → **Pass Type IDs** → идентификатор: `pass.pro.rightwindow`, описание Right Window.
2. Сгенерировать CSR локально:
   ```bash
   openssl req -new -newkey rsa:2048 -nodes \
     -keyout wallet/certs/pass.key -out wallet/certs/pass.csr \
     -subj "/CN=Right Window Pass/O=Maxim Perekatov/C=US"
   ```
3. В портале: выбранный Pass Type ID → Create Certificate → загрузить `pass.csr` → скачать `pass.cer`.
4. Конвертировать и добыть WWDR G4:
   ```bash
   openssl x509 -inform DER -in pass.cer -out wallet/certs/pass.pem
   curl -s https://www.apple.com/certificateauthority/AppleWWDRCAG4.cer \
     | openssl x509 -inform DER -out wallet/certs/wwdr.pem
   ```

## 2. APNs Auth Key (портал → Keys)
Keys → «+» → имя RightWindowPush → включить **Apple Push Notifications service (APNs)**
→ Continue → скачать `AuthKey_XXXXXXXXXX.p8` (Key ID показан там же; скачивается один раз).
Team ID — в правом верхнем углу Membership.

## 3. Залить секреты
```bash
cd /Users/maxi/rightwindow
b64() { base64 < "$1" | tr -d '\n'; }
AUTH_SECRET=$(openssl rand -hex 24)

for kv in \
  "PASS_TYPE_ID=pass.pro.rightwindow" \
  "APPLE_TEAM_ID=ВАШ_TEAM_ID" \
  "PASS_AUTH_SECRET=$AUTH_SECRET" \
  "PASS_CERT_PEM_B64=$(b64 wallet/certs/pass.pem)" \
  "PASS_KEY_PEM_B64=$(b64 wallet/certs/pass.key)" \
  "WWDR_PEM_B64=$(b64 wallet/certs/wwdr.pem)" ; do
  printf '%s' "${kv#*=}" | vercel env add "${kv%%=*}" production
done

gh secret set APNS_KEY_P8_B64 --body "$(b64 wallet/certs/AuthKey_XXXXXXXXXX.p8)"
gh secret set APNS_KEY_ID     --body "XXXXXXXXXX"
gh secret set APPLE_TEAM_ID   --body "ВАШ_TEAM_ID"
gh secret set PASS_TYPE_ID    --body "pass.pro.rightwindow"
# BLOB_READ_WRITE_TOKEN уже установлен

vercel deploy --prod   # после env-переменных
```

После этого кнопка «Add to Apple Wallet» появится на сайте сама ((/api/pass/status)),
устройства начнут регистрироваться, и каждый час при новых окнах пасс будет
обновляться с уведомлением на локскрине: «New: 3 buildings · 2 contracts».
