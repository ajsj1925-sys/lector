# Lector

App para leer manga y ver anime guardados en tu propio dispositivo (PC, tablet y móvil).
Es una **PWA**: una web que se instala como app y funciona sin conexión. No hay servidor de contenido:
todo lo que añades o descargas se guarda en el navegador del dispositivo (IndexedDB).

## Abrirla
- **PC, para probar:** en esta carpeta, `python -m http.server 8080` y abrir http://localhost:8080
  (con doble clic sobre index.html no funciona el modo sin conexión).
- **Móvil/tablet:** abrir la web publicada (GitHub Pages) → Instalar / Añadir a pantalla de inicio.

## Estructura
| Archivo | Qué hace |
|---|---|
| `index.html` | Esqueleto de la app |
| `css/app.css` | Estilos (PC: barra lateral · tablet: barra estrecha · móvil: barra abajo) |
| `js/db.js` | Almacenamiento local (IndexedDB) |
| `js/zip.js` | Lee CBZ/ZIP sin librerías |
| `js/demo.js` | Datos de ejemplo (borrables en Ajustes) |
| `js/addons.js` | Add-ons y gestor de descargas |
| `js/reader.js` | Lector de manga |
| `js/player.js` | Reproductor de anime |
| `js/app.js` | Interfaz: vistas, ficha de serie, importar, ajustes |
| `sw.js` | Sin conexión + recibir archivos desde "Compartir" (Android) |
| `docs/ADDONS.md` | Cómo crear add-ons |
| `BITACORA.md` | Diario del proyecto |
