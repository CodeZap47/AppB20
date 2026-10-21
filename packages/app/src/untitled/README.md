# Untitled UI para la navegación de B20

La navegación parte del componente gratuito oficial [Sidebar Slim de Untitled
UI](https://www.untitledui.com/react/components/sidebar-navigations#slim) y sus
auxiliares del [repositorio público de Untitled UI
React](https://github.com/untitleduico/react/tree/main/components/application/app-navigation).
Se incorpora bajo la licencia MIT incluida en `LICENSE`.

El código vive en `components/application/app-navigation` y usa el alias
`@b20-ui/*`. Las adaptaciones conservan el rail de 68 px y el submenú de 256 px
superpuesto; incluyen marca B20, cuenta actual, etiquetas en español y enlaces de
React Router compatibles con la navegación por hash. La selección de ruta es
independiente del grupo abierto temporalmente y reconoce páginas hijas y los
alias de Inicio, Perfiles y Tareas y Actividades.

La propiedad `compact` fuerza la cabecera y el cajón usados también en móvil.
Los estilos son compartidos entre web/PWA, extensión y Capacitor, conservan el
azul B20 y siguen el modo oscuro del sistema. Las animaciones usan `motion` y
respetan la preferencia de movimiento reducido. El cajón usa un diálogo de React
Aria con retorno del foco al cerrar.

`foundation.css` carga Tailwind sin Preflight global y limita la detección de
clases a este directorio. El reset solo afecta `.b20-navigation` y
`.b20-navigation-overlay`, incluidos sus portales. Los estilos de los demás
módulos conservan su ámbito. Revisar estas adaptaciones antes de actualizar los
componentes desde su fuente.

Documentación: [Untitled UI React](https://www.untitledui.com/react/docs/installation).
