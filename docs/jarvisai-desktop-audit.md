# Auditoría de JarvisAI Desktop

Fecha: 15 de julio de 2026

## Estado actual

JarvisAI se está distribuyendo como aplicación de escritorio de Windows con
Tauri 2. La aplicación contiene el frontend React y arranca un backend local
empaquetado; no necesita que el usuario final instale Docker, Node, Python,
Rust, `uv` u Ollama.

La experiencia de escritorio ya incluye:

- ventana nativa, icono de bandeja, instancia única y arranque con Windows;
- backend local y runtime Python portable incluidos en el instalador;
- activación por voz, reconocimiento local y funciones de cámara/gestos;
- selección de proveedor cloud y almacenamiento de claves en el almacén de
  credenciales del sistema operativo;
- comprobación de actualizaciones al abrir la app y cada 30 minutos.

La PWA no forma parte del empaquetado de Tauri: no hay manifiesto ni registro
de service worker activos. Las antiguas rutas web y Docker siguen en el árbol
como herramientas de contribución, no como ruta de instalación de usuario.

## Hallazgos que hay que resolver antes de una primera versión pública

1. **El historial sigue siendo el de OpenJarvis.** `main` contiene 924 commits
   heredados y el remoto `origin` aún apunta a `open-jarvis/OpenJarvis`. Esto
   explica los contribuidores, la cronología y el aspecto de proyecto derivado
   en GitHub. No lo provoca la licencia.
2. **La identidad de aplicación todavía es heredada.** El identificador Tauri
   es `com.openjarvis.desktop`, el esquema profundo es `openjarvis://` y quedan
   textos, enlaces, rutas de datos y documentación de OpenJarvis. Un producto
   independiente debe usar una identidad propia y un plan de migración para no
   perder datos de instalaciones existentes.
3. **El README y la documentación pública no describen JarvisAI.** Aún incluyen
   logo, enlaces, instrucciones, colaboradores y texto de OpenJarvis.
4. **El actualizador está cableado, pero no es todavía propiedad de JarvisAI.**
   La URL de releases ya se ajusta a `Machi2603/JarvisAI` en CI, pero la clave
   pública configurada coincide con la de upstream. Hay que generar y guardar
   un par de claves exclusivo antes de publicar instaladores.

## Actualización automática: arquitectura aprobada

El flujo usa el plugin updater de Tauri y GitHub Releases:

1. Un tag `desktop-vX.Y.Z` dispara `.github/workflows/desktop.yml`.
2. GitHub Actions construye el instalador NSIS, firma el artefacto y publica la
   release estable.
3. El workflow actualiza el canal `desktop-latest/latest.json`.
4. Las instalaciones consultan ese manifiesto, verifican la firma y ofrecen la
   descarga e instalación.

Por tanto no hay que construir ni distribuir manualmente un `.exe` en cada
cambio. Sí hay que publicar una release estable cuando se quiera entregar una
actualización a usuarios.

Los secretos de GitHub configurados el 15 de julio de 2026 son:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- `VITE_SUPABASE_ANON_KEY` solo si se mantiene la funcionalidad que la necesita

La clave privada nunca se añade al repositorio. La pública se incorpora a
`frontend/src-tauri/tauri.conf.json`.

## Orden recomendado

1. Conservar la atribución requerida por Apache-2.0 y crear un historial limpio
   de JarvisAI en GitHub.
2. Eliminar el remoto de escritura a upstream y actualizar el README, licencia,
   enlaces y metadatos del producto.
3. Generar el par de claves del updater, guardar la privada como secretos de
   GitHub y reemplazar la clave pública heredada.
4. Publicar `desktop-v1.0.0` y probar la actualización desde una compilación
   anterior.
5. Solo entonces iniciar el rediseño visual, sobre una identidad y un canal de
   publicación estables.
