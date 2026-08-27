# Slack — подключение за 3 минуты

Два режима. **Входящий вебхук** (простой, для одной команды) работает сразу.
**Кнопки Claim** требуют одного секрета — без него карточки придут, но нажатия не сработают.

## 1. Вебхук (обязательный минимум)

1. https://api.slack.com/apps → **Create New App** → From scratch → имя `Right Window`,
   выбрать рабочее пространство.
2. Слева **Incoming Webhooks** → включить **On** → **Add New Webhook to Workspace** →
   выбрать канал (например `#new-windows`) → Allow.
3. Скопировать URL вида `https://hooks.slack.com/services/T…/B…/…`
4. На сайте, в зелёном блоке внизу, вставить его в поле **Slack incoming webhook URL** →
   «Send to Slack». В канал сразу придёт подтверждение.

Готово: новые окна под ваш профиль будут падать в канал — срочные в течение 10 минут,
остальные утренним дайджестом.

## 2. Кнопки Claim / Not for us

1. В том же приложении: **Interactivity & Shortcuts** → включить **On** →
   Request URL: `https://rightwindow.vercel.app/api/slack/interact` → Save.
2. **Basic Information** → скопировать **Signing Secret**.
3. Добавить его на Vercel:
   ```bash
   printf '%s' 'ВСТАВИТЬ_SIGNING_SECRET' | vercel env add SLACK_SIGNING_SECRET production
   vercel deploy --prod
   ```

Теперь «Claim it» в Слаке ставит тот же глобальный статус, что и на сайте: у всех
остальных сигнал становится жёлтым, и команда не звонит дважды.

## Что куда идёт

| Событие | Канал | Когда |
|---|---|---|
| Свежее нарушение, слушание ≤30 дней, смена собственника | Slack + email | в течение 10 минут |
| Здание из «My buildings» получило любое новое событие | Slack + email | в течение 10 минут |
| Всё остальное по профилю | дайджест | утром, только если есть новое |
