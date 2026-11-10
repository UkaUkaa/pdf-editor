# PDF Editor

Кроссплатформенный настольный редактор PDF для Windows и macOS (Electron + React + TypeScript).

**Состояние:** пройдены все восемь фаз — защищённая оболочка, просмотр PDF, управление страницами,
редактирование (текст с кириллицей, изображения, фигуры, рисование), слои, поиск, закладки, водяные знаки,
комментарии, ссылки, вложения, OCR, экспорт в изображения, проект `.pdfproject`, автосохранение и
восстановление, защита паролем (AES-256), системные шрифты, проверка обновлений, инсталляторы для macOS и Windows
(публикуются в [UkaUkaa/pdf-editor-releases](https://github.com/UkaUkaa/pdf-editor-releases/releases)). Не сделаны печать, сжатие и
водяной знак-изображение. Установщик Windows собран, но не запускался; подписи разработчика нет.
Точный список сделанного и несделанного — в [PROJECT_STATUS.md](PROJECT_STATUS.md).

## Быстрый старт

Требуется Node.js ≥ 22.12.

```bash
npm install
npm run dev
```

Если после установки нет бинарника Electron (npm заблокировал install-скрипт):

```bash
node node_modules/electron/install.js
```

## Команды

| Команда | Назначение |
| --- | --- |
| `npm run dev` | Запуск с горячей перезагрузкой |
| `npm run build` | Сборка в `out/` |
| `npm start` | Запуск собранного приложения |
| `npm run fixtures` | Пересоздать тестовые PDF в `tests/fixtures` |
| `npm run check` | Типы + линтер + юнит-тесты |
| `npm run test:e2e` | Сборка и сквозные тесты на реальном приложении |
| `npm run package:mac` / `package:win` | Инсталляторы (DMG / NSIS) — ещё не проверялись |

## Документация

- [PROJECT_STATUS.md](PROJECT_STATUS.md) — статус, решения, план.
- [ARCHITECTURE.md](ARCHITECTURE.md) — устройство приложения.
- [DEVELOPMENT.md](DEVELOPMENT.md) — правила разработки.
- [CHANGELOG.md](CHANGELOG.md) — история изменений.
