// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../../data/DataContext';
import { createDemoState, DemoDataSource } from '../../data/demo';
import type { DataSource, Snapshot } from '../../data/types';
import { formatDate, parseDay } from '../../lib/format';
import type { NewsItem, NewsKind } from '../../lib/whatsNew';
import { FeedCard } from './FeedCard';
import { FeedExcerpt } from './FeedContent';

const now = new Date('2026-10-26T18:00:00Z');
let data: Snapshot;
let demo: DemoDataSource;
let source: DataSource;
let root: Root;
let container: HTMLDivElement;
const item = (kind: NewsKind, id: string, targetKind?: NonNullable<NewsItem['target']>['kind']): NewsItem => ({
  key: `${kind}:${id}`, kind, at: now, actorId: 'demo-2', text: 'Aviso sin información estructurada',
  subjectId: 'subject', link: `/recurso/${id}`, target: targetKind ? { kind: targetKind, id } : undefined,
  resource: targetKind ? undefined : { kind, id },
});
async function renderNode(node: ReactNode) {
  await act(async () => root.render(<DataProvider source={source}><MemoryRouter>{node}</MemoryRouter></DataProvider>));
}
async function mount(news: NewsItem) {
  const target = news.target;
  const post = target?.kind === 'post' ? data.feedPosts.find((entry) => entry.id === target.id) : undefined;
  await renderNode(<FeedCard item={news} snapshot={data} now={now} isNew={false} post={post}
    comments={post ? data.feedComments.filter((entry) => entry.postId === post.id) : []}
    reactions={target ? data.feedReactions.filter((entry) => entry.targetKind === target.kind && entry.targetId === target.id) : []} />);
}
function button(label: string) {
  const node = [...container.querySelectorAll('button')].find((entry) => entry.getAttribute('aria-label') === label || entry.textContent?.trim() === label);
  if (!node) throw new Error(`Falta botón ${label}`); return node;
}
async function click(label: string) { await act(async () => button(label).click()); }
async function change(control: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(control, value);
    control.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function ownPost() {
  data.feedPosts = [{ id: 'post', authorId: 'demo-1', text: 'Conversación de B20', subjectId: 'subject', createdAt: now }];
  data.feedComments = [{ id: 'comment', postId: 'post', authorId: 'demo-1', text: 'Comentario del autor', createdAt: now }];
  return { ...item('publicacion', 'post', 'post'), actorId: 'demo-1' };
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  demo = new DemoDataSource(createDemoState(now), 'demo-1', () => now); source = demo;
  data = { ...demo.getSnapshot(), subjects: [{ id: 'subject', name: 'Programación', period: 1 }] };
  vi.spyOn(source, 'getSnapshot').mockImplementation(() => data);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); demo.dispose(); container.remove(); vi.restoreAllMocks(); });

describe('tarjetas y contenido integrado del feed', () => {
  it.each([
    ['tarea', 'Tarea'], ['actividad', 'Actividad académica'], ['exposicion', 'Exposición'], ['examen', 'Examen académico'],
  ] as const)('presenta %s con etiqueta, materia, estado, instrucciones y entrega propias', async (kind, label) => {
    data.assignments = [{ ...data.assignments[0]!, id: 'assignment', subjectId: 'subject', kind,
      title: 'Estudiar funciones', instructions: 'Explica el paso por valor', dueDate: '2026-10-30', version: 2 }];
    await mount(item('tarea', 'assignment', 'assignment'));
    expect(container.querySelector('.feed-type')?.textContent).toBe(label);
    expect(container.querySelector('.feed-subject')?.textContent).toBe('Programación');
    expect(container.querySelector('.feed-status')?.textContent).toBe('Con fecha de entrega');
    expect(container.querySelector('h3')?.textContent).toBe('Estudiar funciones');
    expect(container.querySelector('.feed-facts')?.textContent).toContain('2026');
    expect(container.querySelector('.feed-content')?.textContent).toContain('Explica el paso por valor');
    expect(container.querySelector('h3 a')?.getAttribute('href')).toBe('/recurso/assignment');
  });

  it('presenta nota con origen, etiquetas y fichas de archivo; tolera que no existan adjuntos', async () => {
    const note = data.notes.find((entry) => entry.visibility === 'group')!;
    data.notes = [{ ...note, id: 'note', subjectId: 'subject', title: 'Conclusiones de la sala', body: 'Aprendimos a trazar la pila', tags: ['sala-de-estudio', 'Recursión'], version: 3 }];
    data.resourceFiles = [{ id: 'file', targetKind: 'note', targetId: 'note', name: 'Conclusiones.pdf', size: 2048, contentType: 'application/pdf', uploadedBy: 'demo-2', createdAt: now }];
    const news = item('nota', 'note', 'note'); await mount(news);
    expect(container.querySelector('.feed-content__eyebrow')?.textContent).toBe('Sala de estudio');
    expect(container.querySelector('.feed-tags')?.textContent).toContain('#Recursión');
    expect(container.querySelector('.feed-tags')?.textContent).not.toContain('sala-de-estudio');
    expect(container.querySelector('.feed-attachment')?.textContent).toContain('Conclusiones.pdf');
    expect(container.querySelector('.feed-attachment')?.textContent).toContain('2 KB · PDF');
    data.resourceFiles = []; await mount(news);
    expect(container.querySelector('.feed-attachments')).toBeNull();
    expect(container.querySelector('h3')?.textContent).toBe('Conclusiones de la sala');
  });

  it('muestra respuesta aceptada y cuenta sólo respuestas vigentes desde los datos originales', async () => {
    data.questions = [{ id: 'question', authorId: 'demo-2', subjectId: 'subject', topic: 'Recursión', title: '¿Cómo termina?', body: 'Quiero entender el caso base', status: 'resolved', acceptedAnswerId: 'answer', resolvedAt: now, createdAt: now }];
    data.answers = [{ id: 'answer', questionId: 'question', authorId: 'demo-3', body: 'Termina al alcanzar el caso base.', createdAt: now }, { id: 'removed', questionId: 'question', authorId: 'demo-2', body: 'Respuesta retirada', createdAt: now, withdrawnAt: now }];
    await mount(item('resuelta', 'question', 'question'));
    expect(container.querySelector('.feed-type')?.textContent).toBe('Pregunta resuelta');
    expect(container.querySelector('.feed-status')?.textContent).toBe('Respuesta aceptada');
    expect(container.querySelector('.feed-content__blocks')?.textContent).toContain('Termina al alcanzar el caso base.');
    expect(container.querySelector('.feed-facts')?.textContent).toBe('Respuestas1');
    expect(container.textContent).not.toContain('Respuesta retirada');
    expect(button('Responder pregunta')).toBeDefined();
  });

  it.each([false, true])('Ver más expande texto/código (%s) sin interpretar HTML', async (code) => {
    const text = `Primera línea ${'contenido '.repeat(80)}<script>window.inseguro = true</script>última línea`;
    await renderNode(<FeedExcerpt text={text} code={code} />);
    expect(container.textContent).not.toContain('última línea');
    const more = button('Ver más'); const contentId = more.getAttribute('aria-controls');
    expect(document.getElementById(contentId!)).not.toBeNull(); expect(more.getAttribute('aria-expanded')).toBe('false');
    await click('Ver más');
    expect(container.textContent).toContain(text); expect(button('Ver menos').getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('script')).toBeNull();
    expect(Boolean(container.querySelector('pre code'))).toBe(code);
    await click('Ver menos'); expect(container.textContent).not.toContain('última línea');
  });

  it('renderiza fechas ISO de calendario y la retirada sin RangeError y conserva datetime válido', async () => {
    const assignment = { ...data.assignments[0]!, id: 'dated', subjectId: 'subject', dueDate: '2026-10-31' };
    data.assignments = [assignment];
    data.revisions = [1, 2].map((version) => ({ id: `date${version}`, page: 'assignment', pageId: 'dated', title: 'Cambio', summary: '', body: '', version, dueDate: version === 1 ? '2026-10-30' : '2026-10-31', editedBy: 'demo-2', editedAt: now }));
    const news = { ...item('fecha', 'dated', 'assignment'), key: 'fdate2' };
    await mount(news);
    expect(container.querySelector('.feed-date-change del')?.textContent).toBe(formatDate(parseDay('2026-10-30')));
    expect(container.querySelector('.feed-date-change strong')?.textContent).toBe(formatDate(parseDay('2026-10-31')));
    expect(container.querySelector('time')?.dateTime).toBe(now.toISOString());
    data = { ...data, assignments: [{ ...assignment, dueDate: undefined }], revisions: data.revisions.map((revision) => revision.version === 2 ? { ...revision, dueDate: undefined } : revision) };
    await mount(news);
    expect(container.querySelector('.feed-status')?.textContent).toBe('Fecha retirada');
    expect(container.querySelector('.feed-date-change strong')?.textContent).toBe('Sin fecha de entrega');
    expect(container.querySelector('.feed-date-change del')?.textContent).toBe(formatDate(parseDay('2026-10-30')));
  });

  it('deshabilita edición, eliminación y comentarios al estar sin conexión', async () => {
    const news = ownPost(); data = { ...data, connection: 'offline' };
    const edit = vi.spyOn(source, 'editFeedPost'); const remove = vi.spyOn(source, 'deleteFeedPost'); const removeComment = vi.spyOn(source, 'deleteFeedComment');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await mount(news);
    expect(button('Editar publicación').disabled).toBe(true); expect(button('Eliminar publicación').disabled).toBe(true);
    expect(button('Eliminar comentario').disabled).toBe(true);
    expect((container.querySelector('input[aria-label="Escribe un comentario"]') as HTMLInputElement).disabled).toBe(true);
    await click('Eliminar publicación'); await click('Eliminar comentario');
    expect(edit).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled(); expect(removeComment).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled();
  });

  it('conserva la edición abierta cuando se desconecta y bloquea guardar', async () => {
    const news = ownPost(); const edit = vi.spyOn(source, 'editFeedPost');
    await mount(news); await click('Editar publicación');
    await change(container.querySelector('textarea[aria-label="Editar publicación"]')!, 'Edición que debe conservarse');
    data = { ...data, connection: 'offline' }; await mount(news);
    expect(button('Guardar').disabled).toBe(true);
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Edición que debe conservarse');
    await act(async () => container.querySelector('form.feed-card__edit')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(edit).not.toHaveBeenCalled();
  });

  it.each(['reto', 'solucion', 'revision', 'observacion', 'oportunidad', 'sala', 'examen', 'ranking'] as const)('no ofrece reacciones sobre el recurso nuevo %s sin target admitido', async (kind) => {
    const react = vi.spyOn(source, 'toggleFeedReaction');
    await mount(item(kind, 'resource'));
    expect(container.querySelector('[aria-label="Reaccionar"]')).toBeNull(); expect(react).not.toHaveBeenCalled();
  });

  it('museo conserva el target original de pregunta al reaccionar', async () => {
    const react = vi.spyOn(source, 'toggleFeedReaction').mockResolvedValue(undefined);
    await mount(item('museo', 'question', 'question'));
    await click('Reaccionar');
    const emoji = container.querySelector('.reaction-picker button')!;
    const expectedEmoji = emoji.textContent;
    await act(async () => (emoji as HTMLButtonElement).click());
    expect(react).toHaveBeenCalledWith({ targetKind: 'question', targetId: 'question', emoji: expectedEmoji });
  });

  it('al desconectarse también deshabilita los emojis de un selector ya abierto', async () => {
    const news = ownPost(); const react = vi.spyOn(source, 'toggleFeedReaction');
    await mount(news); await click('Reaccionar'); data = { ...data, connection: 'offline' }; await mount(news);
    const emojis = [...container.querySelectorAll<HTMLButtonElement>('.reaction-picker button')];
    expect(emojis.length).toBeGreaterThan(0); expect(emojis.every((entry) => entry.disabled)).toBe(true);
    await act(async () => emojis[0]!.click()); expect(react).not.toHaveBeenCalled();
  });
});
