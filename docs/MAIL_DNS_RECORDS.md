# DNS для почты tehstroinvest.ru

В REG.RU для зоны `tehstroinvest.ru` нужны эти записи. Значения A `@`, A `www`, A `workspace-90780` и почтовые записи `mail` для другого сервера не смешивать.

| Тип | Имя | Значение |
| --- | --- | --- |
| A | `mail` | `188.127.249.187` (заменить прежний `87.251.78.28`) |
| MX | `@` | Приоритет `10`, сервер `mail.tehstroinvest.ru.` |
| TXT | `@` | `v=spf1 ip4:188.127.249.187 -all` (заменить прежний SPF) |
| TXT | `mail2026._domainkey` | `v=DKIM1; h=sha256; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA9jomf51FfPB7xhgsW/f0V+5BwST34Sh9fI9jKL2DmCM6FoDPncGcuib/y2+yLULrkS/VlfExbL/ORQfP5TpNFyQ5X3ByC1rfu12xatTzydtotAfh3ctVPCZ2x8BEO1KrGKFQzoYUoIsU+UtNeYBWRWj7iQL8KFbz/SbjxyRQ4hb6tq3qwuf5JYA5K+l+7ZlANzzyopmq6pXyLe4lOMR6pc/hzKlWwGL7/54L2QBpsPXlBOlUnG2lgK4SE9FlYWyCYyq70GKjOaRyHVegW+sWh431MN/3H73X54ENpaK4QVvIVMd44ROTUdkwE+WQ4Mrb9y0q8RDcQd18GEMEE7BugQIDAQAB` |

Существующий TXT `_dmarc` оставить. Старый TXT `mail._domainkey` пока можно оставить: он относится к другому селектору и не мешает `mail2026`. После проверки можно удалить, если нигде не используется.

Для IP `188.127.249.187` отдельно в SmartApe нужен PTR/rDNS `mail.tehstroinvest.ru`. После изменения A мы выпустим доверенный сертификат и включим приём/отправку в CRM. До этого не менять MX в одиночку: внешний приём тогда пойдёт на ещё не проверенную связку.
