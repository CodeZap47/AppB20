import { useState } from 'react';
import { Icon } from '../Icon';
import { ChatButton } from './Messaging';

const ANDROID_PATH = 'Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Stickers';

export function StickerHelp() {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(ANDROID_PATH);
      setCopied(true); setError('');
    } catch { setError('No se pudo copiar. Puedes seleccionar la ruta y copiarla manualmente.'); }
  };
  return <section className="sticker-help" aria-labelledby="sticker-help-title">
    <div className="sticker-section-heading"><span className="sticker-section-icon"><Icon name="smile" /></span><div><h3 id="sticker-help-title">¿Cómo saco mis stickers de WhatsApp?</h3><p>Elige tu dispositivo y sigue los pasos.</p></div></div>
    <div className="sticker-help__platforms">
      <details><summary><span>Android<small>Desde la app de archivos</small></span><Icon name="forward" size={16} /></summary><ol>
        <li>Abre la app Archivos de tu celular.</li><li>Busca la carpeta de stickers de WhatsApp. Su ubicación puede variar según tu dispositivo.</li>
        <li><div className="sticker-help__path"><code>{ANDROID_PATH}</code><ChatButton variant="secondary" onClick={() => void copy()} aria-label="Copiar ruta de Android"><Icon name={copied ? 'check' : 'copy'} size={16} />{copied ? 'Copiada' : 'Copiar'}</ChatButton></div></li>
        <li>Selecciona los archivos .webp que quieras y súbelos aquí.</li>
      </ol>{copied && <p role="status" className="sticker-help__feedback">Ruta copiada.</p>}{error && <p role="alert" className="error">{error}</p>}</details>
      <details><summary><span>Computadora<small>WhatsApp Web o Escritorio</small></span><Icon name="forward" size={16} /></summary><ol><li>Abre el chat donde está el sticker.</li><li>Si aparece la opción al hacer clic derecho, elige «Guardar imagen como…».</li><li>Guarda la imagen y arrástrala al área de importación.</li></ol></details>
      <details><summary><span>iPhone<small>Usa una computadora o un paquete</small></span><Icon name="forward" size={16} /></summary><ol><li>Abre WhatsApp Web en una computadora para guardar los stickers disponibles como imagen.</li><li>También puedes usar un paquete .wastickers que hayas exportado desde una app de stickers.</li><li>Selecciona el archivo desde el área de importación.</li></ol></details>
      <details><summary><span>Ya tengo un paquete<small>Archivos .wastickers o .zip</small></span><Icon name="forward" size={16} /></summary><ol><li>Selecciona o arrastra el paquete completo.</li><li>Revisa las miniaturas y el nombre antes de importar.</li><li>Las imágenes compatibles se importan juntas; verás cuáles se omitieron.</li></ol></details>
    </div>
    <p className="sticker-help__note"><Icon name="lock" size={16} />Tus paquetes empiezan privados. Comparte con el salón solo los stickers que puedas compartir.</p>
  </section>;
}
