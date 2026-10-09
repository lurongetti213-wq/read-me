# Puente After Effects ⇄ Claude

Permite que Claude lea el estado de tu proyecto de After Effects y le envíe scripts, usando este repo como canal.

## Instalación (una vez)
1. Clona este repo en tu computadora y cambia a la rama `claude/compassionate-sagan-u21lk7`.
2. Instala Node.js (v18+).
3. En After Effects: *Edición > Preferencias > Scripting y expresiones* → activa **Permitir que los scripts escriban archivos y accedan a la red**.
4. Si After Effects no está en la ruta por defecto, edita `bridge/config.json` (`aeExe` en Windows, `aeApp` en macOS).

## Uso
1. Abre tu proyecto en After Effects.
2. En la carpeta del repo: `node bridge/watcher.js --confirm`
   - `--confirm` te muestra cada comando y pide aprobación antes de ejecutarlo (recomendado).
3. El watcher exporta el estado a `state/ae-state.json` y lo sube. Claude lo lee y escribe comandos en `commands/pending.jsx`.
4. Cada comando corre dentro de un grupo de deshacer: **Ctrl+Z / Cmd+Z** lo revierte completo.

Solo exportar una vez, sin ejecutar nada: `node bridge/watcher.js --export-only`
Exportar a mano: *Archivo > Scripts > Ejecutar archivo de script…* → `ae/export_state.jsx` (guarda `ae-state.json` en el escritorio).

## Seguridad
El watcher ejecuta código del repo en tu máquina. Usa un repo **privado** y `--confirm`.
