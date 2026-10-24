import { describe, expect, it } from 'vitest';
import { DISPLAY_NAME_MAX_LENGTH, displayNameError } from './profiles';

describe('nombre obligatorio del grupo', () => {
  it.each(['', ' ', '\t\n'])('rechaza el nombre vacío %j', (name) => {
    expect(displayNameError(name)).toBe('El nombre es obligatorio.');
  });

  it.each(['alumno@example.com', ' Alumno@Example.com ', '@', 'Ana @ Pérez'])('rechaza cualquier arroba en %j', (name) => {
    expect(displayNameError(name)).toBe('Escribe tu nombre, no tu correo electrónico.');
  });

  it.each(['Ana', 'José Ángel', '李', 'Ana-María O’Neill', 'Á'.repeat(DISPLAY_NAME_MAX_LENGTH)])('admite el nombre %j', (name) => {
    expect(displayNameError(name)).toBeUndefined();
    expect(displayNameError(`  ${name}  `)).toBeUndefined();
  });

  it('mide el límite después de quitar los espacios de los extremos', () => {
    expect(DISPLAY_NAME_MAX_LENGTH).toBe(80);
    expect(displayNameError(` ${'a'.repeat(DISPLAY_NAME_MAX_LENGTH + 1)} `)).toBe('El nombre excede 80 caracteres.');
  });
});
