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

## 2026-11-11 · Publicación
- El usuario creó el repo vacío **ajsj1925-sys/lector** (público). Se subió el código a `main` y a `gh-pages`
  (con `.nojekyll`); al empujar `gh-pages` GitHub activó Pages solo.
- **Web: https://ajsj1925-sys.github.io/lector/** (comprobado que carga).
- Para actualizar: hacer commit y `git push origin main` **y** `git push origin main:gh-pages`.
- Al publicar una versión nueva, subir `CACHE` en `sw.js` (p. ej. `lector-v0.2.1`) para que los móviles la descarguen.

## 2026-11-12 · v0.3.0 · Los 14 puntos pendientes
**Petición:** el usuario pidió hacer las 14 mejoras de la lista ("A todas. A las 14"). Se hicieron todas.

| # | Qué | Cómo (archivos) |
|---|---|---|
| 1 | **Telegram desde la app** | `js/tg.js`. GramJS cargado al usarlo desde `esm.sh/telegram@2.26.22` (+ `esm.sh/buffer@6.0.3` puesto como `globalThis.Buffer`, si no falla). Login con número → código → contraseña 2FA (`client.start`). Sesión (`StringSession`) en `kv.telegram`. Chat genérico con cualquier bot: texto, comandos, botones inline (`msg.click({i,j})`), teclados de respuesta, refresco cada 3 s. "Descargar" usa `client.iterDownload` por trozos de 512 KB (no carga 1 GB en RAM) y guarda en la biblioteca; álbumes de fotos → un capítulo. No hacen falta los comandos de los bots: el chat sirve para cualquiera. |
| 2 | PDF, EPUB, CBR/RAR, 7Z, CBT | `js/formats.js` detecta el formato por los primeros bytes. PDF con pdf.js (`vendor/pdfjs`), EPUB propio (lee OPF y spine), RAR/7z/TAR con libarchive.js WASM (`vendor/libarchive`). |
| 3 | Subtítulos .ass/.ssa | `js/subs.js` los pasa a WebVTT (sin estilos avanzados; respeta arriba/abajo). |
| 4 | MKV en iPhone/iPad | `js/mkv.js`: demuxer EBML propio + `vendor/mp4-muxer.min.js`. Copia vídeo (H.264/H.265/VP9/AV1) y audio (AAC/Opus) sin recodificar, calcula DTS con B-frames, añade edit list (elst) para que audio y vídeo queden sincronizados, extrae subtítulos internos. Al añadir un MKV se convierte siempre (así hay subtítulos internos en todos los dispositivos). Si el audio es AC3/FLAC/DTS no se puede (aviso). |
| 5 | Ver online | Add-ons de streaming: `url` (vídeo o cbz) o `pages` (imágenes) se abren sin descargar. |
| 6 | Sincronizar progreso | `js/backup.js` + `Tg.sync()`: sube `lector-sync.json` a "Mensajes guardados" (#lector-sync) y lee el último; por capítulo gana el `lastAt` más reciente. Al abrir la app y al salir (cada 5 min máx.). |
| 7 | Avisos de capítulos nuevos | `js/notify.js`: interruptor "Avisarme" en la ficha. Revisa bots (archivos cuyo nombre encaja con la serie) y streaming al abrir y cada 20 min. Fila "Novedades" en Inicio + notificación del sistema. Sin servidor no avisa con la app cerrada. |
| 8 | Copia de seguridad | Ajustes → Exportar/Importar copia (.json, sin los archivos pesados). |
| 9 | Reproductor con gestos | `js/player.js` reescrito: controles propios, doble toque ±10 s, arrastrar para avanzar, brillo (izq.) y volumen (dcha.), mantener = 2×, "Saltar opening" (80/85/90 s), tamaño de subtítulos, pistas, añadir subtítulo, PiP, siguiente automático. Si un MKV falla, botón "Convertir a MP4". |
| 10 | Listas, valoración, notas | Listas editables (Leyendo, Pendiente, Favoritos, Abandonado…), 5 estrellas, notas; filtro por lista y orden por valoración; fila Favoritos en Inicio. |
| 11 | Información automática | `js/meta.js`: AniList GraphQL (sin cuenta). Al añadir busca solo si el título coincide; también a mano desde la ficha. Guarda portada y banner reducidos (funcionan sin conexión). |
| 12 | Datos de ejemplo | Ya no se cargan; se borran al actualizar (kv `v3`). Se pueden cargar desde Ajustes. |
| 13 | Probar en móvil real | Ajustes → **Diagnóstico**: dice qué funciona en ese dispositivo (instalada, espacio, HEVC, MKV, notificaciones…). |
| 14 | Espacio en iPhone | `js/space.js`: comprueba espacio antes de guardar; opción "borrar lo ya visto si falta espacio"; botón liberar; pide almacenamiento persistente. |

**Probado** (Playwright, local): PDF, EPUB, CBT, RAR v5, 7z y ASS; MKV H.264+B-frames+AAC+ASS y MKV HEVC+Opus → MP4 válido (ffmpeg decodifica sin errores, tiempos idénticos al original); importación, reproductor (pistas, doble toque), listas, estrellas, notas, exportar copia en un "PC" e importarla en un "iPhone" (progreso y "No está en este dispositivo"). En el navegador real (web publicada): GramJS carga y funciona con el `Buffer` global. **No probado**: iniciar sesión real en Telegram (necesita las claves y el código del usuario).

**Librerías incluidas** (`vendor/`, con sus licencias): pdf.js 3.2.146 (Apache-2.0), libarchive.js (MIT), mp4-muxer (MIT). Externas al usarlas: GramJS 2.26.22 y buffer 6.0.3 vía esm.sh (el service worker las guarda para usarlas sin conexión).

## 2026-11-13 · v0.4.0 · Catálogo en Explorar y add-ons abiertos
**Petición:** "que se vean los primeros animes y demás del catálogo; busca add-ons gratis y méteselos" (anime y manga).
**Decisión:** no se incluyen add-ons que cojan series de webs que las suben sin permiso (AnimeFLV, Consumet, scrapers de MangaDex, etc.).
Se le propusieron 4 fuentes legales y aprobó 3 (sin el archivo de dominio público), y pidió que la app acepte también otros add-ons.

| Qué | Cómo (archivos) |
|---|---|
| Catálogo en Explorar | `js/catalog.js` (nuevo). AniList GraphQL, una sola petición con alias para 4 filas: Tendencias, Esta temporada (manga: En publicación), Más populares, Mejor valorados. Selector Anime/Manga, fila de géneros (14), búsqueda. Caché 6 h en `kv` (`cat:*`) → abre al momento y sin conexión muestra lo último. `isAdult:false` siempre. |
| Inicio | Filas "Anime en tendencia" y "Manga en tendencia" al final (si no hay conexión ni caché, no salen; máx. 6 s de espera). Con biblioteca vacía: aviso pequeño + esas filas. |
| Ficha del catálogo | Ids `c:<anilistId>` → `catalogDetail()` en `js/app.js`: banner, datos, estudio, próximo episodio, géneros, sinopsis, "Si te gusta, prueba" (recomendaciones), botones Tráiler, "Quiero verlo/leerlo" (lista `kv.wish`, sale como fila en Explorar), "Pedir a mi bot" (abre el chat con el título escrito), "Buscar en mis add-ons", y "En tu biblioteca" si ya la tienes (por `meta.id`). |
| Dónde verlo / leerlo | `externalLinks` de AniList tipo STREAMING (oficiales: Crunchyroll, Netflix, MANGA Plus…), primero YouTube y los de idioma español. |
| YouTube oficial | Enlaces de YouTube de AniList marcados "Gratis"; si son vídeo o lista se ven incrustados (`ytSheet`, youtube-nocookie), si son canal se abren fuera. Aviso: pueden no estar disponibles en todos los países. Tráileres también incrustados. |
| Add-ons de Stremio | `js/addons.js`: al instalar una URL (o `stremio://`) cuyo JSON es un manifest de Stremio se convierte a `type:"stremio"` (`fromStremio`). Filas de catálogos en Explorar (`Addons.home`), búsqueda, ficha con temporadas/episodios, enlaces (`Addons.streams`): url directa → reproductor o descarga; ytId → YouTube; externalUrl → fuera; torrent → no compatible. Ids `r:<addon>:<tipo>|<id>` (el id puede llevar `:`; `ridOf()` en app.js). Formato propio de streaming: nuevo campo opcional `catalog`. Documentado en `docs/ADDONS.md`. |
| Arreglo | `js/player.js`: tras cerrar el reproductor el vídeo emitía eventos que daban error en consola; ahora se ignoran (`live()`). |

**Probado** (Playwright, PC y móvil, AniList y un add-on Stremio simulados): filas del catálogo en Inicio y Explorar, manga, géneros, búsqueda (catálogo + add-on), ficha con enlaces y recomendaciones, guardar, tráiler y lista de YouTube incrustados, instalar `stremio://…`, fila del add-on, episodios ordenados, hoja de enlaces (torrent desactivado) y reproducción. Sin errores de consola.

## Pendiente
1. Que el usuario saque api_id/api_hash en my.telegram.org, inicie sesión en Ajustes y pruebe sus bots (si algo falla, mirar la consola del navegador).
2. Probar en su Android, iPhone y iPad (Ajustes → Diagnóstico) y ajustar lo que salga.
3. EPUB de solo texto (novelas ligeras): no soportado.
4. Avisos con la app cerrada: necesitaría un servidor (no se quiere).
5. Comprobar el catálogo con la conexión real de AniList en sus dispositivos (en la prueba estaba simulado).
6. HLS (.m3u8) de add-ons no se ve en Chrome/Android (haría falta hls.js).
