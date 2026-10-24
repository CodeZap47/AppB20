import { Link } from 'react-router';

export function InstallPage() {
  return (
    <>
      <h1>Instalar B20</h1>
      <p>Instala la app web de B20 en tu teléfono para abrirla desde su icono y recibir avisos con tu permiso. Estos pasos corresponden a la PWA, sin descargar un APK.</p>

      <h2>iPhone</h2>
      <ol>
        <li>Con iOS 16.4 o superior, abre <a href="https://b20.mx">https://b20.mx</a> en Safari.</li>
        <li>
          Toca <strong>Compartir</strong> y luego <strong>Añadir a pantalla de inicio</strong> o <strong>Agregar a Inicio</strong>.
          Si aparece <strong>Abrir como app web</strong>, déjalo activado y confirma con <strong>Agregar</strong>.
        </li>
        <li>Abre B20 desde el icono nuevo e inicia sesión.</li>
      </ol>

      <h2>Android</h2>
      <ol>
        <li>Abre <a href="https://b20.mx">https://b20.mx</a> en Chrome.</li>
        <li>
          Abre el menú de Chrome y elige <strong>Instalar y crear acceso directo</strong> → <strong>Instalar</strong>.
          El nombre puede variar según la versión; sigue las instrucciones de instalación.
        </li>
        <li>Abre B20 desde su icono e inicia sesión.</li>
      </ol>

      <h2>Activar avisos en este teléfono</h2>
      <ol>
        <li>Desde B20, abre <Link to="/ajustes?pestana=avisos">Ajustes → Avisos</Link> y elige qué avisos quieres recibir.</li>
        <li>Marca <strong>Enviar también a mis dispositivos registrados</strong> y pulsa <strong>Guardar preferencias</strong>.</li>
        <li>Pulsa <strong>Activar en este dispositivo</strong> y elige <strong>Permitir</strong> cuando el teléfono solicite autorización.</li>
      </ol>
      <p>Usa siempre la dirección segura <strong>https://b20.mx</strong>. En iPhone, activa los avisos desde la app añadida a inicio. El permiso se solicita al pulsar el botón; la bandeja de avisos sigue disponible si no lo concedes.</p>

      <h2>Si los avisos están bloqueados</h2>
      <ul>
        <li><strong>iPhone:</strong> abre Ajustes → Notificaciones → B20 y permite las notificaciones.</li>
        <li><strong>Android:</strong> revisa las notificaciones de B20 o Chrome en los ajustes del teléfono. En Chrome, abre b20.mx y entra en Información de la página → Permisos → Notificaciones para elegir <strong>Permitir</strong>.</li>
      </ul>
      <p>Después vuelve a B20 y pulsa <strong>Activar en este dispositivo</strong>. Si ya rechazaste el permiso, el teléfono puede no volver a mostrar la solicitud hasta que lo cambies en sus ajustes.</p>
      <p className="muted">Los modos de Concentración/No molestar, el descanso configurado en B20 y los ajustes de pantalla bloqueada pueden silenciar o posponer los avisos.</p>

      <p className="muted">
        Ayuda oficial: <a href="https://support.apple.com/es-mx/guide/iphone/iph42ab2f3a7/ios">instalar en iPhone</a>,{' '}
        <a href="https://support.google.com/chrome/answer/9658361?hl=es-419&co=GENIE.Platform%3DAndroid">instalar en Android</a> y{' '}
        <a href="https://support.google.com/chrome/answer/3220216?hl=es-419&co=GENIE.Platform%3DAndroid">permisos en Chrome</a>.
      </p>
    </>
  );
}
