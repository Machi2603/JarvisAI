# Diseño: división de los monolitos de Rust y React

Fecha: 2026-07-15

## Alcance

Refactorización estrictamente mecánica de `frontend/src-tauri/src/lib.rs` y
`frontend/src/pages/AgentsPage.tsx`. No se modifican comportamiento, interfaz
visual, nombres ni argumentos de comandos Tauri, APIs, dependencias,
`package.json`, `Cargo.toml` ni almacenamiento. Los cambios ajenos ya presentes
en el árbol de trabajo quedan fuera de alcance.

## División de Rust

Se extraen módulos directos desde `frontend/src-tauri/src/`:

- `backend.rs`: `BackendManager`, procesos hijos, apagado, localización de
  Python/proyecto/ejecutables, arranque de backend y satellite, health checks,
  puertos, diagnósticos y `SetupStatus`, `SharedBackend`, `SharedStatus`.
- `inference.rs`: `SourceKind`, `InferenceConfig`, `BootPlan`, selección por
  RAM, Groq/Ollama/endpoints personalizados, configuración, claves y modelos
  Ollama.
- `commands.rs`: comandos Tauri que consultan backend, telemetría, memoria,
  agentes, modelos, ahorro, ejecución Jarvis, transcripción, speech health y
  HTTP auxiliar.
- `overlay.rs`: implementación nativa macOS existente y comandos del overlay,
  conservando los `cfg(target_os)` actuales.

`lib.rs` conservará únicamente declaraciones de módulos, inicialización de
estado, plugins, bandeja, autostart, ventana principal, `generate_handler!`,
bucle de ejecución y cierre. Los símbolos serán `pub(crate)` solo cuando lo
requiera otro módulo y las pruebas permanecerán junto a su implementación.

## División de React

Se crea `frontend/src/pages/agents/` sin `index.ts` agregador:

- `shared.tsx`: badges, indicadores, formateadores, tipos y constantes
  compartidos.
- `LaunchWizard.tsx`: `ToolsPicker` y pasos/estado/instrucciones de creación.
- `AgentOverview.tsx`: `AgentCard`, `OverflowMenu`, configuración e
  instrucciones.
- `InteractTab.tsx`: conversación en directo, pasos y llamadas a herramientas.
- `MessagingTabs.tsx`: fuentes, canales, formularios y asistente SendBlue.
- `DiagnosticsTabs.tsx`: aprendizaje y logs.

`AgentsPage.tsx` conservará carga, selección/actualización, polling, acciones
principales, navegación y composición. Se mueven JSX y lógica sin rediseño,
cambios de textos, timers, llamadas API ni manejo de errores.

## Verificación

Se ejecutará la baseline antes de editar, `cargo fmt --check` y `cargo test`
tras cada extracción Rust, comprobación TypeScript tras cada extracción React,
y al final:

```text
cargo fmt --check
cargo test
npm test
npm run lint
npm run build:tauri
git diff --check
```

Se comprobarán los 35 tests Rust, las pruebas Vitest, los comandos de
`generate_handler!`, tamaños objetivo de ambos monolitos y ausencia de cambios
en dependencias. Los commits serán:

```text
docs: plan monolith split
refactor(desktop): split tauri responsibilities
refactor(frontend): split agents page components
```
