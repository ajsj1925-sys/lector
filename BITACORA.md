# Bitácora · Lector

Diario del proyecto, pensado para que otro Claude (o yo mismo en otra sesión) pueda seguirlo.
Carpeta en el PC: `C:\Users\user\Desktop\Saule Claude\Lector`.

## Qué es
App personal para **leer manga y ver anime** en PC, tablet y móvil (Android + iPhone/iPad).
- Uso **solo personal**. Sin servidor: cada dispositivo guarda sus propios archivos.
- Fuentes: archivos que sube el usuario + **sus propios bots de Telegram** (contenido gratis y legal, según el usuario;
  tiene unos 2, quiere poder añadir más) + **add-ons de streaming**.
- Preferencias del usuario: interfaz compacta (poco scroll, sin cambiar de pestaña), todo en español,
  explicar antes de hacer y esperar visto bueno (en este proyecto dio vía libre: "constrúyelo tú").

## Decisiones
| Decisión | Por qué |
|---|---|
| PWA (HTML/CSS/JS sin framework ni build) | Un solo código para PC, Android e iOS; se instala desde el navegador; sin dependencias que instalar |
| IndexedDB para guardar archivos | Funciona offline y sin servidor; Blobs grandes (vídeos) caben |
| Lector CBZ propio con `DecompressionStream` | Sin librerías; funciona en Chrome, Edge, Firefox y Safari 16.4+ |
| Telegram con la **cuenta del usuario** (MTProto/GramJS), no con token de bot | La Bot API solo deja descargar archivos de hasta 20 MB; con cuenta, hasta 2 GB |
| Add-ons como JSON (`docs/ADDONS.md`) | El usuario puede añadir fuentes sin tocar código |
| Alojar en GitHub Pages | Hace falta HTTPS para instalar la PWA en móvil; solo aloja la app, no el contenido |

## Avisos técnicos
- Safari (iPhone/iPad) **no reproduce MKV**. MP4/WebM sí.
- iOS borra datos de webs no instaladas tras unas semanas sin uso → instalar en pantalla de inicio.
- "Compartir → Lector" solo existe en Android (Web Share Target). En iOS se importa con el botón Añadir.

---

## 2026-11-11 · v0.1.0 · Interfaz completa con datos de ejemplo
**Qué se hizo**
1. Estructura del proyecto y PWA (manifest, service worker con caché offline e iconos 192/512).
2. **Navegación**: Inicio, Biblioteca, Explorar, Descargas, Ajustes. Barra lateral en PC, estrecha en tablet, abajo en móvil.
3. **Inicio**: "Continuar" (último episodio/capítulo con progreso) + añadido recientemente.
4. **Biblioteca**: filtros Todo/Anime/Manga, búsqueda, orden.
5. **Ficha de serie**: panel a la derecha en PC/tablet, pantalla completa en móvil. Lista de episodios/capítulos
   con progreso, se centra en el actual; menú por elemento (marcar visto, marcar hasta aquí, borrar archivo) y por
   serie (modo de lectura, renombrar, reiniciar progreso, borrar).
6. **Lector de manga** (`js/reader.js`): modos Manga (derecha→izquierda), Cómic y Webtoon (scroll vertical),
   doble página automática en horizontal, ajustar al ancho, toques laterales, deslizar, teclado, barra de páginas,
   paso automático al siguiente capítulo, guarda la página.
7. **Reproductor** (`js/player.js`): vídeo nativo, subtítulos .srt/.vtt, velocidad, recuerda el minuto,
   visto al 90 %, "siguiente episodio" con cuenta atrás, atajos (espacio, flechas, F).
8. **Importar**: botón Añadir (archivos o carpeta) y arrastrar en PC. Detecta serie y número del nombre
   (ej. `[Sub] Serie - 02 [1080p].mp4` → "Serie", ep. 2). Portada: primera página del CBZ o fotograma del vídeo.
   Subtítulos con el mismo nombre se asocian al vídeo.
9. **Add-ons**: tipo Telegram (formulario) y Streaming (URL/JSON). Catálogo de ejemplo incluido para probar
   Explorar y Descargas. Formato documentado en `docs/ADDONS.md`.
10. **Descargas**: cola (2 a la vez), progreso, agrupado por serie, espacio usado/disponible.
11. **Ajustes**: add-ons, claves de Telegram (api_id/api_hash, se guardan solo en el dispositivo),
    preferencias de lectura, instalar, quitar datos de ejemplo.

**Probado** con Playwright en PC (1440×900), iPad horizontal e iPhone 13: sin errores de consola;
importación de un CBZ (4 páginas, doble página RTL correcta) y de un MP4 + SRT (pista de subtítulos cargada).

**Archivos**: todos los de la tabla del README.

## 2026-11-11 (noche) · v0.2.0 · Lector con todos los modos + interfaz nueva
**Petición del usuario:** "la interfaz mucho mejor" y que el lector de manga permita leer "de todas las formas que se pueda".
Dio vía libre ("Venga, empieza") con el plan: estilo tipo Crunchyroll + Mihon.

**Lector de manga (`js/reader.js`, reescrito entero)**
- 6 modos: Manga (dcha→izq), Cómic (izq→dcha), Vertical paginado, Webtoon (scroll continuo),
  Tira horizontal (dcha→izq o izq→dcha) y **Viñeta a viñeta** (detecta viñetas con cortes XY por los huecos
  blancos sobre una copia reducida de la página; primero página entera y luego cada viñeta con zoom animado).
- Página: encaje pantalla/ancho/alto/original; doble página auto/sí/no (las páginas anchas van solas);
  "desplazar una página" (portada sola); **partir páginas dobles** en vertical; **recortar bordes**
  (detecta márgenes por luminancia); fondo negro/gris/blanco; separación y ancho en webtoon.
- Controles: zonas táctiles Lados / En L / Arriba-abajo / Solo menú (+ invertir, con mapa visual);
  animación Deslizar / Hoja (giro 3D) / Fundido / Ninguna; auto-scroll con velocidad; pantalla siempre
  encendida (Wake Lock); pantalla completa; bloqueo de giro (Android).
- Color: brillo, sepia, blanco y negro, **modo noche** (invertido) con botón directo en la barra.
- Zoom: pellizco y doble toque (móvil), Ctrl+rueda o +/− (PC); arrastrar para mover.
- Extras: miniaturas para saltar, página de "fin de capítulo" con el siguiente, perfiles rápidos
  (Manga, Cómic, Webtoon, Noche), la configuración se guarda **por serie** (`series.reader`) y
  "Usar en todas" la guarda como predeterminada (`kv.readerPrefs`).
- Si la página es más alta/ancha que la pantalla (encaje ancho/alto), pasar primero desplaza dentro de ella.

**Interfaz (`css/app.css` reescrito, `js/app.js` ampliado)**
- Inicio: **banner** grande con lo último que estabas viendo/leyendo (fondo difuminado de la portada,
  rota cada 8 s entre los 5 últimos), y filas horizontales: Continuar, Añadido recientemente, Por empezar,
  Anime, Manga, Terminados (con flechas en PC).
- Portadas con efecto al pasar el ratón, botón de reproducir y etiqueta NUEVO.
- Ficha de serie: fondo difuminado, chips de datos, pestañas **Capítulos / Información / Lectura**,
  orden 1→9 / 9→1 y filtro "Sin leer". En "Lectura" se elige el modo con que se abre esa serie.
- **Temas**: Oscuro, Negro puro (OLED) y Claro + 8 colores de acento (Ajustes → Apariencia).
- Buscador en la barra superior (busca en la biblioteca).
- Móvil: banner compacto, ficha como pantalla deslizante, ajustes del lector como hoja inferior.

**Probado** con Playwright (PC 1440×900, iPad horizontal, iPhone 13) usando un CBZ de prueba con viñetas y una
página doble: los 6 modos, doble página RTL, desplazar, recortar, viñetas en orden manga, noche, miniaturas,
tema claro, toque lateral en móvil. Sin errores de consola.

## Pendiente (siguiente pasos, en orden)
1. Publicar en GitHub Pages (repo `lector`) para instalarla en móvil y tablet.
2. **Telegram**: iniciar sesión con GramJS en el navegador (número + código), elegir bot, mandar comando,
   recibir el archivo y descargarlo a la biblioteca. Necesita los **comandos de los bots** del usuario.
3. Ver online (sin descargar) para add-ons de streaming reales.
4. Formatos que faltan: **PDF** (pdf.js), **EPUB**, **CBR** (RAR, necesita librería), subtítulos **.ass**.
5. Exportar/importar progreso entre dispositivos (archivo), opcional.
