const minimumMajor = 22;
const major = Number(process.versions.node.split('.')[0]);

if (major < minimumMajor) {
  console.error(
    `AppB20 requiere Node.js ${minimumMajor} o superior; estás usando ${process.version}.\n` +
    'Desde la carpeta del proyecto, ejecuta «nvm use» para seleccionar la versión de .nvmrc.\n' +
    'Si todavía no está instalada, ejecuta «nvm install» y después «nvm use».',
  );
  process.exitCode = 1;
}
