# Кабинет финала на GitHub Pages

GitHub Pages отдаёт интерфейс кабинета. Supabase проверяет логины, выдаёт каталог и PDF только аккаунтам из списка жюри. Вход выполняется напрямую через HTTPS API Supabase. Сеанс хранится в открытой вкладке. После перезагрузки страницы понадобится войти снова.

## Настройка Supabase

1. Создайте отдельный проект для финала. Отключите свободную регистрацию и анонимный вход. Укажите URL кабинета в настройках Auth.
2. Выполните `schema.sql` в этом проекте. Политики допуска сравнивают идентификатор входящего пользователя со списком жюри. Каталог и PDF доступны только на чтение.
3. Запустите `provision.mjs` с двумя путями. Первый указывает на закрытую папку с ответами Supabase CLI `project.json` и `api-keys.json` для выделенного проекта `a-house-mts-jury`. Во втором лежит каталог, подготовленный `import-materials.py`.

```sh
node jury/final/hosted/provision.mjs /private/contest/setup /private/contest/final
```

Скрипт создаёт 15 индивидуальных учёток и закрытый бакет. После проверки допуска он сохраняет `public-config.json` для сборки и `jury-access.tsv` для организатора. Каждый член жюри получает свою пару логина и пароля. Файлы с доступами и PDF хранятся в закрытых папках.

## Сборка и проверка

Укажите URL проекта и его публичный ключ `sb_publishable_…` в переменных окружения.

```sh
export JURY_SUPABASE_URL=https://PROJECT_REF.supabase.co
export JURY_SUPABASE_PUBLISHABLE_KEY=sb_publishable_EXAMPLE
node jury/final/hosted/build.mjs /tmp/a-house-jury-site
```

Публикуйте только файлы сборки. Браузерная проверка проходит путь от входа до PDF и обратно в эмуляции iPhone 13 и в Chrome.

```sh
node jury/final/hosted/check.mjs https://YOUR_PAGES_URL/ /private/contest/setup /private/contest/final
```
