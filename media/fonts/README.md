# Шрифты сайта A–House

Роли взяты с разворотов 249–251 брендбука и описаны в [проектном справочнике](../../docs/interface-design.md). Общие гарнитуры заданы в `src/styles/typography.css`, файлы подключены в `ahouse-fonts.css`.

| Роль | Начертание | Исходный файл из комплекта | Веб-файл |
| --- | --- | --- | --- |
| Заголовки | Times New Roman Cyr Condensed, 400 | `TimesNewRomanCyr-Cond.ttf` | `times-new-roman-cyr-condensed.woff2` |
| Наборный текст | Apercu Condensed Pro Light, 300 | `ApercuCondensedPro-Light.ttf` | `apercu-condensed-pro-light.woff2` |
| Навигация и подписи | Apercu Condensed Pro Regular, 400 | `Apercu Condensed Pro Regular.ttf` | `apercu-condensed-pro-regular.woff2` |
| Акценты и основные действия | Apercu Condensed Pro Medium, 500 | `Apercu Condensed Pro Medium.ttf` | `apercu-condensed-pro-medium.woff2` |
| Документы | Apercu Pro Regular, 400 | `apercu_regular_pro.otf` | `apercu-pro-regular.woff2` |
| Жирные выделения в документах | Apercu Pro Bold, 700 | `apercu_bold_pro.otf` | `apercu-pro-bold.woff2` |
| Курсив в статьях | Apercu Pro Italic, 400 | `ApercuPro-Italic.ttf` | `apercu-pro-italic.woff2` |

WOFF2 подготовлены из полученных архивов с fontTools 4.60.2 и Brotli 1.2.1. При проверке совпали карта символов, ширины глифов и флаги `OS/2.fsType`. Во всех начертаниях есть русский алфавит с Ё/ё. Noto Serif дополняет заголовочную гарнитуру для отдельных знаков, в том числе номера и рубля.

## Совместимость с импортированным оформлением

В исходном CSS имя `AHTimes` обозначает разные гарнитуры. Вес 400 выбирает Times New Roman Cyr Condensed, вес 500 — Apercu Condensed Pro Regular. На `/moscow_business/` отдельный файл `ahouse-fonts-moscow.css` назначает Apercu Condensed Pro Regular и для веса 300.

Для партнёрских ролей `AHTimes` 600 и 700 используются компактный и широкий экземпляры Roboto Flex. Самостоятельный лендинг `/mts/` подключает шрифты из исходного оформления.

## Открытые гарнитуры

В `provenance.json` собраны адреса исходников, оси, SHA-256, размеры и проверка символов открытых файлов. Тексты лицензий SIL OFL 1.1 лежат рядом с файлами.

- [Noto Serif — официальный источник](https://github.com/google/fonts/tree/main/ofl/notoserif), файл `notoserif-OFL.txt`.
- [Roboto Condensed — официальный источник](https://github.com/google/fonts/tree/main/ofl/robotocondensed), файл `robotocondensed-OFL.txt`.
- [Roboto Flex — официальный источник](https://github.com/google/fonts/tree/main/ofl/robotoflex), файл `robotoflex-OFL.txt`.

Команда `python3 tools/import_media.py --fonts-only --python-deps /путь/к/fonttools-и-brotli` обновляет открытые файлы и их происхождение. Правила подключения редактируются в CSS.
