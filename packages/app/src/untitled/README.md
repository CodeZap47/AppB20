# Untitled UI para B20

Componentes gratuitos generados con `untitledui@0.1.69`, biblioteca v8, desde
`packages/app`:

```sh
npx untitledui@latest add button avatar textarea dropdown tooltip --include-all-components
```

`components.json` dirige el código a este directorio mediante `@b20-ui/*`.
Las bases de mensajería y sus auxiliares se reutilizan en el sidebar. Las burbujas,
cabeceras y adaptadores de B20 viven en `components/messaging`; no se usa el
componente PRO `messaging` ni sus ejemplos.

La navegación parte del componente gratuito oficial [Sidebar Slim de Untitled
UI](https://www.untitledui.com/react/components/sidebar-navigations#slim) y sus
auxiliares, incorporados en `components/application/app-navigation`. Sus
fuentes gratuitas conservan la licencia MIT de Untitled UI en `LICENSE`. Las
adaptaciones incluyen marca B20, cuenta actual, etiquetas en español, enlaces de
React Router, submenús superpuestos y la cabecera/cajón para móvil y panel de
extensión. La propiedad `compact` fuerza esta última presentación. La selección
por ruta es independiente del grupo abierto temporalmente. Las animaciones usan
`motion` y respetan la preferencia de movimiento reducido.

Los estilos se comparten entre web/PWA, extensión y Capacitor. `foundation.css`
carga Tailwind sin Preflight global y detecta clases en este directorio y los
adaptadores de mensajería. El reset solo afecta `.b20-messaging`,
`.b20-messaging-overlay`, `.b20-navigation` y `.b20-navigation-overlay`; incluye
los portales de menús y cajones sin cambiar los controles de otros módulos. El
tema conserva el azul B20, las fuentes del sistema y el modo oscuro automático.

Adaptaciones locales a los componentes generados: portales de menús/tooltips con
el ámbito de estilos, nombres accesibles en español y combinación de `style` en
`TextAreaBase`. Revisar estas adaptaciones antes de regenerar; no sobrescribir
archivos con `--yes` ni `--overwrite` sin revisar sus diferencias.

Documentación: [Untitled UI React](https://www.untitledui.com/react/docs/installation).
