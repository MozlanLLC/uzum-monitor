# Uzum Монитор цен

Android-приложение: следит за ценой, наличием и количеством товаров на uzum.uz,
проверяет каждые полчаса (в :00 и :30) и присылает уведомление при изменениях.

**Скачать APK:** https://github.com/MozlanLLC/uzum-monitor/releases/latest/download/uzum-monitor.apk

- `android/` — оболочка приложения. При изменениях GitHub Actions собирает новый APK и публикует его в Releases.
- `web/` — обновляемая часть: интерфейс (`ui.html`) и логика чтения карточки товара (`extract.js`).
  Приложение само скачивает её, когда в `manifest.json` увеличивается `version`, — переустанавливать APK не нужно.
