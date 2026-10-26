// @vitest-environment jsdom
import { act, createRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PasswordField } from './PasswordField';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const toggle = () => container.querySelector<HTMLButtonElement>('.password-field__toggle')!;

describe('campo de contraseña', () => {
  it('alterna sin enviar el formulario y conserva el input, su referencia y los atributos nativos', async () => {
    const ref = createRef<HTMLInputElement>();
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    await act(async () => root.render(<form onSubmit={submit}>
      <PasswordField label="Contraseña" id="password" ref={ref} value="password-example" onChange={() => {}}
        autoComplete="new-password" required minLength={8} maxLength={256} autoFocus />
    </form>));
    const input = ref.current!;
    expect(input.type).toBe('password');
    expect(input.labels?.[0]?.textContent).toBe('Contraseña');
    expect(document.activeElement).toBe(input);
    expect(toggle().getAttribute('aria-controls')).toBe(input.id);
    expect(toggle().getAttribute('aria-label')).toBe('Mostrar contraseña');
    expect(toggle().querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    await act(async () => toggle().click());
    expect(input.type).toBe('text');
    expect(ref.current).toBe(input);
    expect(input.value).toBe('password-example');
    expect(input.autocomplete).toBe('new-password');
    expect(input.required).toBe(true);
    expect(input.minLength).toBe(8);
    expect(input.maxLength).toBe(256);
    expect(input.getAttribute('autocapitalize')).toBe('none');
    expect(input.getAttribute('spellcheck')).toBe('false');
    expect(toggle().getAttribute('aria-label')).toBe('Ocultar contraseña');
    expect(submit).not.toHaveBeenCalled();
    await act(async () => toggle().click());
    expect(input.type).toBe('password');
    expect(input.value).toBe('password-example');
  });

  it('no permite revelar un campo deshabilitado', async () => {
    await act(async () => root.render(<PasswordField label="Clave personal" value="example" disabled visibilityLabel="clave de Gemini" />));
    expect(toggle().disabled).toBe(true);
    expect(toggle().getAttribute('aria-label')).toBe('Mostrar clave de Gemini');
    await act(async () => toggle().click());
    expect(container.querySelector('input')!.type).toBe('password');
  });

  it('restablece la visibilidad al limpiar o volver a montar el campo', async () => {
    function Example({ revision }: { revision: string }) {
      const [value, setValue] = useState('example');
      return <><PasswordField key={revision} label="Contraseña" value={value} onChange={(event) => setValue(event.target.value)} />
        <button type="button" onClick={() => setValue('')}>Limpiar</button></>;
    }
    await act(async () => root.render(<Example revision="one" />));
    await act(async () => toggle().click());
    expect(container.querySelector('input')!.type).toBe('text');
    await act(async () => container.querySelectorAll<HTMLButtonElement>('button')[1]!.click());
    expect(container.querySelector('input')!.type).toBe('password');
    expect(container.querySelector('input')!.value).toBe('');
    await act(async () => toggle().click());
    expect(container.querySelector('input')!.type).toBe('text');
    await act(async () => root.render(<Example revision="two" />));
    expect(container.querySelector('input')!.type).toBe('password');
  });
});
