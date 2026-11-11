# Add-ons de Lector

Un add-on es una **fuente** de anime o manga. Se instala en **Ajustes → Add-ons → + Añadir**.
Hay dos tipos.

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

> Estado (v0.1.0): se guardan y aparecen en Explorar. Falta conectar la cuenta de Telegram (MTProto con la librería GramJS)
> y los comandos reales de cada bot.

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
Para manga, cada elemento puede traer `"pages": ["https://…/1.jpg", "https://…/2.jpg"]` en lugar de `url`,
o una `url` a un `.cbz`.

Al pulsar **Descargar**, Lector baja el archivo y lo guarda en el dispositivo.
**Ver online** sin descargar: pendiente para fuentes reales (funciona con el catálogo de ejemplo).

Solo para contenido que tengas derecho a usar (tuyo, libre o con licencia).
