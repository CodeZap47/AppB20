# Untitled UI para la mensajería de B20

Componentes gratuitos generados con `untitledui@0.1.69`, biblioteca v8, desde
`packages/app`:

```sh
npx untitledui@latest add button avatar textarea dropdown tooltip --include-all-components
```

`components.json` dirige el código a este directorio mediante `@b20-ui/*`.
Los componentes auxiliares son dependencias de estas cinco bases. Las burbujas,
cabeceras y adaptadores de B20 viven en `components/messaging`; no se usa el
componente PRO `messaging` ni sus ejemplos.

Los estilos se comparten entre web/PWA, extensión y Capacitor. `foundation.css`
carga Tailwind sin Preflight global y limita la detección de clases a mensajería.
El reset solo afecta `.b20-messaging` y `.b20-messaging-overlay`. El tema conserva
el azul B20, las fuentes del sistema y el modo oscuro automático.

Adaptaciones locales a los componentes generados: portales de menús/tooltips con
el ámbito de estilos, nombres accesibles en español y combinación de `style` en
`TextAreaBase`. Revisar estas adaptaciones antes de regenerar; no sobrescribir
archivos con `--yes` ni `--overwrite` sin revisar sus diferencias.

Las fuentes gratuitas conservan la licencia MIT de Untitled UI en `LICENSE`.
Documentación: [Untitled UI React](https://www.untitledui.com/react/docs/installation).
