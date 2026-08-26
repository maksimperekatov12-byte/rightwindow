# Email-дайджест — включение за 3 минуты

Пайплайн готов: пользователи оставляют почту на сайте (блок «Daily digest»), она
уезжает в prefs/{uid}.json вместе с профилем и боро; workflow `daily-digest`
(каждый день 12:07 UTC ≈ 8:07 утра Нью-Йорка) собирает персональные новинки под
профиль и шлёт письмо. Без RESEND_API_KEY шаг молча пропускается.

1. https://resend.com → Sign up (бесплатно, 100 писем/день).
2. API Keys → Create → скопировать.
3. `gh secret set RESEND_API_KEY --body "re_..."`
4. (потом, для писем с собственного адреса) Domains → добавить домен, DNS-записи,
   затем `gh secret set DIGEST_FROM --body "Right Window <digest@yourdomain.com>"`.
   До этого письма идут с onboarding@resend.dev — для тестов достаточно.
5. Проверка: `gh workflow run daily-digest` и смотреть лог.
