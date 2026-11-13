# Add-ons de Lector

Un add-on es una **fuente** de anime o manga. Se instala en **Ajustes → Add-ons → + Añadir**.
Hay tres tipos. Lector no trae ninguno de contenido: el catálogo de Explorar (AniList) solo muestra fichas,
tráileres y enlaces oficiales.

## 1. Bot de Telegram (`"type": "telegram"`)

Uno de tus bots. Se crea desde el formulario de la app (no hace falta JSON), pero este es el formato:

```json
{
  "type": "telegram",
  "name": "Mi bot de anime",
  "bot": "@mibot",
  "kinds": ["anime", "manga"],
  "commands": { "search": "/buscar {q}" }
}
```

- `bot`: usuario del bot, con `@`.
- `kinds`: qué manda (`anime`, `manga` o ambos).
- `commands.search`: comando para buscar; `{q}` se cambia por lo que escribas. Vacío = se manda el texto tal cual.

> Desde v0.3.0: en Explorar → "Abrir chat" hablas con el bot dentro de Lector (texto, comandos, botones)
> y cada archivo que mande tiene un botón "Descargar" que lo mete en la biblioteca. `commands.search` solo sirve
> para rellenar el mensaje cuando buscas algo en Explorar.

## 2. Streaming (`"type": "streaming"`)

Un catálogo online con búsqueda. Se instala pegando la URL de su `addon.json` (o el JSON directamente).
El servidor de la fuente tiene que permitir CORS (`Access-Control-Allow-Origin: *`).

```json
{
  "type": "streaming",
  "name": "Mi catálogo",
  "version": "1.0.0",
  "search": "https://ejemplo.com/api/search?q={q}&kind={kind}",
  "series": "https://ejemplo.com/api/series/{id}"
}
```

### Respuesta de `search`
```json
{ "results": [ { "id": "abc", "title": "Título", "kind": "anime", "cover": "https://…/portada.jpg", "desc": "…" } ] }
```

### Respuesta de `series`
```json
{
  "id": "abc", "title": "Título", "kind": "anime", "cover": "https://…", "desc": "…",
  "items": [
    { "num": 1, "title": "Episodio 1", "url": "https://…/ep1.mp4", "type": "video/mp4", "size": 312000000 },
    { "num": 2, "title": "Episodio 2", "url": "https://…/ep2.mp4" }
  ]
}
```
Opcional: `"catalog": "https://ejemplo.com/api/destacados"` (misma respuesta que `search`) para que salga una fila en Explorar sin buscar nada.

Para manga, cada elemento puede traer `"pages": ["https://…/1.jpg", "https://…/2.jpg"]` en lugar de `url`,
o una `url` a un `.cbz`.

Al pulsar **Descargar**, Lector baja el archivo y lo guarda en el dispositivo.
**Ver online** sin descargar: con `url` (vídeo o .cbz) o `pages` (lista de imágenes).

## 3. Add-ons de Stremio (`"type": "stremio"`, desde v0.4.0)

Lector entiende el protocolo abierto de add-ons de Stremio. En **+ Añadir → Stremio / streaming** pega la URL
de su `manifest.json` (vale también `stremio://…`). Lector lo convierte solo:

- **Catálogos** (`/catalog/{type}/{id}.json`): los 3 primeros sin filtros obligatorios salen como filas en Explorar.
- **Búsqueda** (`/catalog/{type}/{id}/search={q}.json`): en los catálogos que la admiten.
- **Ficha** (`/meta/{type}/{id}.json`): episodios ordenados por temporada y número (`T1 E2 · título`).
- **Enlaces** (`/stream/{type}/{videoId}.json`): `url` directa → se reproduce o descarga; `ytId` → YouTube incrustado;
  `externalUrl` → se abre fuera; torrent (`infoHash`) → no compatible. HLS (`.m3u8`) se ve en iPhone/iPad, no en Chrome.

Desde v0.4.2, como en Stremio, **una fuente da los capítulos y otra los enlaces**:
- Los enlaces de un episodio se piden a **todos** los add-ons activos que tengan `stream` (respetando sus `idPrefixes`).
- Si el add-on de la serie no da ficha (`meta`), se usan los capítulos de otro add-on, de Cinemeta (ids `tt…`) o de Kitsu (ids `kitsu:…`).
- En las fichas del catálogo de anime sale **Episodios**: Lector busca la serie en Kitsu y pide los enlaces con `kitsu:<id>:<episodio>`
  (películas: `kitsu:<id>`), que es lo que usan los add-ons de anime.

**Subtítulos** (desde v0.5.0): los add-ons con recurso `subtitles` (`/subtitles/{type}/{id}.json`) se consultan al ver un episodio
de Stremio; se cargan hasta 8 pistas, primero español.

El add-on tiene que permitir CORS (los de Stremio normalmente lo hacen).

Solo para contenido que tengas derecho a usar (tuyo, libre o con licencia).
