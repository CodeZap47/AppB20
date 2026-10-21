// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { DataProvider } from '../data/DataContext';
import { DemoDataSource, createDemoState } from '../data/demo';
import { MuseumPage } from './MuseumPage';
import { OpportunitiesPage } from './OpportunitiesPage';
let root: Root, container: HTMLDivElement, source: DemoDataSource;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); container = document.createElement('div'); document.body.append(container); root = createRoot(container); source = new DemoDataSource(createDemoState(), 'demo-1'); });
afterEach(async () => { await act(async () => root.unmount()); source.dispose(); container.remove(); });
const show = async (page: ReactNode) => { await act(async () => root.render(<MemoryRouter><DataProvider source={source}>{page}</DataProvider></MemoryRouter>)); };
async function click(text: string) { const button = [...container.querySelectorAll('button')].find((b) => b.textContent === text); expect(button, text).toBeTruthy(); await act(async () => button!.click()); }
async function fill(label: string, value: string) { const element = [...container.querySelectorAll('label')].find((l) => l.childNodes[0]?.textContent === label)?.querySelector('input,textarea,select') as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement; expect(element, label).toBeTruthy(); await act(async () => { const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); }); }
async function submit(text: string) { const button = [...container.querySelectorAll('button')].find((b) => b.textContent === text)!; expect(button).toBeTruthy(); await act(async () => button.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); }
const fields = { intention: 'Hacer un ciclo', symptom: 'No termina', cause: 'Índice inmóvil', correction: '', learning: 'Revisar incremento', minimalCode: 'while (i < 10) {}', evidence: '', language: 'JS', topic: 'Ciclos', bugType: 'Lógico', noteIds: [], questionIds: [] };
const opportunity = { kind: 'event', title: 'Taller Rust', topic: 'Rust', modality: 'online', sourceUrl: 'https://example.com/event', organizer: 'Universidad', requirements: 'Inscripción manual', costKnown: false, cost: '' };
describe('flujos de Museo y Radar', () => {
  it('crea ficha con una pregunta existente y usa el mismo enlace de discusión', async () => {
    const subjectId = source.getSnapshot().subjects[0]!.id; const questionId = source.askQuestion({ subjectId, title: '¿Por qué no termina?', body: 'Contexto', topic: 'Ciclos' });
    await show(<MuseumPage />); await click('Documentar un bug'); await fill('Pregunta de origen', questionId);
    for (const [label, value] of [['Qué intentabas hacer', fields.intention], ['Síntoma observado', fields.symptom], ['Causa o hipótesis', fields.cause], ['Qué aprendiste', fields.learning], ['Lenguaje', fields.language], ['Tema', fields.topic], ['Tipo de error', fields.bugType]]) await fill(label!, value!);
    await submit('Guardar ficha'); expect(source.getSnapshot().museumEntries[0]?.questionId).toBe(questionId); expect(container.querySelector(`a[href="/m/preguntas/${questionId}"]`)?.textContent).toContain('correcciones');
    await click('Editar ficha'); await fill('Corrección (si la conoces)', 'Incrementar i'); await submit('Guardar ficha'); expect(source.getSnapshot().museumEntries[0]?.version).toBe(2); expect(source.getSnapshot().museumRevisions).toHaveLength(2);
  });
  it('publica oportunidad manual y guarda costo desconocido explícito', async () => {
    await show(<OpportunitiesPage />); await click('Compartir oportunidad'); for (const [label, value] of [['Título', opportunity.title], ['Tema', opportunity.topic], ['Organizador', opportunity.organizer], ['Fuente oficial HTTPS', opportunity.sourceUrl], ['Requisitos', opportunity.requirements]]) await fill(label!, value!);
    await submit('Guardar oportunidad'); expect(source.getSnapshot().opportunities[0]).toMatchObject({ title: 'Taller Rust', costKnown: false, cost: '' }); expect(container.textContent).toContain('No conocido'); expect(container.querySelector('a[target="_blank"]')?.getAttribute('href')).toBe(opportunity.sourceUrl);
  });
  it('registra interés privado, autoriza equipo expresamente y lo cancela sin enviar mensajes', async () => {
    source.createOpportunity({ fields: opportunity, requestId: 'create' }); source.setViewer('demo-4'); await show(<OpportunitiesPage />); const messages = source.getSnapshot().directMessages.length;
    await click('Me interesa'); expect(source.getSnapshot().opportunityInterests[0]).toMatchObject({ interested: true, seekingTeam: false, shareContact: false });
    const checkboxes = container.querySelectorAll<HTMLInputElement>('fieldset input[type="checkbox"]'); await act(async () => { checkboxes[0]!.click(); checkboxes[1]!.click(); }); await click('Actualizar mi interés'); expect(source.getSnapshot().opportunityInterests[0]?.shareContact).toBe(true);
    await click('Cancelar mi interés'); expect(source.getSnapshot().opportunityInterests[0]?.interested).toBe(false); expect(source.getSnapshot().directMessages).toHaveLength(messages);
  });
  it('filtros distinguen vencidas sin ofrecer nuevas inscripciones', async () => {
    source.createOpportunity({ fields: { ...opportunity, deadline: '2000-01-01T12:00:00Z' }, requestId: 'expired' }); await show(<OpportunitiesPage />); expect(container.textContent).not.toContain('Taller Rust'); await fill('Mostrar', 'expired'); expect(container.textContent).toContain('Taller Rust'); expect([...container.querySelectorAll('button')].some((b) => b.textContent === 'Me interesa')).toBe(false);
  });
  it('reinicia el consentimiento y los formularios al cambiar de integrante', async () => {
    source.createOpportunity({ fields: opportunity, requestId: 'create' });
    await show(<OpportunitiesPage />); await click('Editar oportunidad');
    await act(async () => source.setViewer('demo-4'));
    expect([...container.querySelectorAll('button')].some((b) => b.textContent === 'Guardar oportunidad')).toBe(false);
    const checkboxes = container.querySelectorAll<HTMLInputElement>('fieldset input[type="checkbox"]');
    await act(async () => { checkboxes[0]!.click(); checkboxes[1]!.click(); });
    await act(async () => source.setViewer('demo-2'));
    expect([...container.querySelectorAll<HTMLInputElement>('fieldset input[type="checkbox"]')].map((input) => input.checked)).toEqual([false, false]);
    await click('Me interesa');
    expect(source.getSnapshot().opportunityInterests.find((interest) => interest.memberId === 'demo-2')).toMatchObject({ interested: true, seekingTeam: false, shareContact: false });
  });
});
