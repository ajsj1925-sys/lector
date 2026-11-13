# Lector

App para leer manga y ver anime guardados en tu propio dispositivo (PC, tablet y móvil).
Es una **PWA**: una web que se instala como app y funciona sin conexión. No hay servidor de contenido:
todo lo que añades o descargas se guarda en el navegador del dispositivo (IndexedDB).

## Abrirla
- **PC, para probar:** en esta carpeta, `python -m http.server 8080` y abrir http://localhost:8080
  (con doble clic sobre index.html no funciona el modo sin conexión).
- **Móvil/tablet:** abrir https://ajsj1925-sys.github.io/lector/ → Instalar / Añadir a pantalla de inicio.

## Estructura
| Archivo | Qué hace |
|---|---|
| `index.html` | Esqueleto de la app |
| `css/app.css` | Estilos (PC: barra lateral · tablet: barra estrecha · móvil: barra abajo) |
| `js/db.js` | Almacenamiento local (IndexedDB) |
| `js/zip.js` | Lee CBZ/ZIP sin librerías |
| `js/formats.js` | PDF, EPUB, CBR/RAR, 7Z, CBT (detecta por contenido) |
| `js/subs.js` | Subtítulos SRT/ASS → WebVTT |
| `js/mkv.js` | MKV → MP4 sin recodificar + subtítulos internos |
| `js/tg.js` | Telegram con tu cuenta: login, chat con bots, descargas, sincronizar |
| `js/notify.js` | Avisos de capítulos nuevos |
| `js/meta.js` | Información de AniList |
| `js/archive.js` | Fuente incluida: Internet Archive (dominio público y licencias libres) |
| `js/catalog.js` | Catálogo de Explorar (AniList): tendencias, temporada, géneros, ficha, tráiler, dónde verlo |
| `js/backup.js` | Copia de seguridad y mezcla de progreso |
| `js/space.js` | Espacio del dispositivo y diagnóstico |
| `vendor/` | pdf.js, libarchive.js (WASM), mp4-muxer |
| `js/demo.js` | Datos de ejemplo (borrables en Ajustes) |
| `js/addons.js` | Add-ons (propios, Stremio, Telegram) y gestor de descargas |
| `js/reader.js` | Lector de manga (6 modos, ajustes por serie) |
| `js/player.js` | Reproductor de anime |
| `js/app.js` | Interfaz: vistas, ficha de serie, importar, ajustes |
| `sw.js` | Sin conexión + recibir archivos desde "Compartir" (Android) |
| `docs/ADDONS.md` | Cómo crear add-ons |
| `BITACORA.md` | Diario del proyecto |
