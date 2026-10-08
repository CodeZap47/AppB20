import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // TODO(Etapa 0): confirmar el identificador definitivo antes de firmar el primer APK;
  // cambiarlo después impide actualizar las instalaciones existentes.
  appId: 'mx.b20.app',
  appName: 'B20',
  webDir: '../web/dist',
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
