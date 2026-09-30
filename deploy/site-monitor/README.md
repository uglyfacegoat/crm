# Мониторинг сайта в CRM

`measure.py` запускается на VPS через `crm-site-monitor.timer` раз в пять минут. Проверка открывает главную страницу `www.tehstroinvest.ru` по HTTPS, считывает срок действия сертификата и реальные CPU, RAM и диск VPS, затем сохраняет запись в `website_health_snapshots`. Показатель доступности считается по проверкам за последние 24 часа; это не гарантия непрерывной доступности между ними.

Монитор работает независимо от ручного паспорта хостинга. Поставщик, тариф, стоимость и дата оплаты должны быть внесены из договора, а посетители и просмотры появятся после подключения счётчика аналитики. Монитор их не выдумывает.

Для установки на действующем VPS: скопировать этот каталог в `/opt/crm-deploy/deploy/site-monitor/`, установить два unit-файла в `/etc/systemd/system/`, выполнить `systemctl daemon-reload && systemctl enable --now crm-site-monitor.timer`. Перед первым запуском должна быть применена миграция `075_website_monitor_capacity_and_tls.sql` обычным запуском CRM. Проверка: `systemctl start crm-site-monitor.service`, `journalctl -u crm-site-monitor.service -n 20 --no-pager`.
