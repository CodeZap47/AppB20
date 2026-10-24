import { describe, expect, it, vi } from 'vitest';
import { Identity, Timestamp } from 'spacetimedb';

vi.mock('spacetimedb/server', () => {
  const builder: unknown = new Proxy({}, { get: () => () => builder });
  const handler = (...args: unknown[]) => args.at(-1);
  return { SenderError: class SenderError extends Error {}, t: new Proxy({}, { get: () => () => builder }),
    table: () => ({ rowType: builder }), schema: () => ({ reducer: handler, procedure: handler, init: handler, clientConnected: handler, view: handler }) };
});
import { withdrawContent } from './communityHandlers';
import * as c4 from './community4Handlers';
import type { Ctx } from './index';
import './index';

const identity = (digit: string) => Identity.fromString(digit.repeat(64));
const admin = identity('a'); const author = identity('b'); const other = identity('c'); const removed = identity('d');
const at = new Timestamp(1_700_000_000_000_000n);
type Row = Record<string, unknown>;
const keyOf = (value: unknown): string => value && typeof value === 'object' && 'toHexString' in value
  ? (value as Identity).toHexString() : String(value);

function store(primary: string, initial: Row[] = []) {
  const rows = new Map(initial.map((row) => [keyOf(row[primary]), row]));
  let next = 100n;
  return new Proxy({ rows, iter: () => rows.values(), insert: (value: Row) => {
    const row: Row = { ...value, ...(value.id === 0n ? { id: next++ } : {}) };
    rows.set(keyOf(row[primary]), row); return row;
  } }, { get(target, name: string) {
    if (name in target) return target[name as keyof typeof target];
    return { find: (value: unknown) => [...rows.values()].find((row) => keyOf(row[name]) === keyOf(value)),
      filter: (value: unknown) => [...rows.values()].filter((row) => keyOf(row[name]) === keyOf(value)),
      update: (row: Row) => { rows.set(keyOf(row[primary]), { ...row }); return row; },
      delete: (value: unknown) => rows.delete(keyOf(value)) };
  } });
}

function setup() {
  const member = [admin, author, other, removed].map((person) => ({ identity: person, displayName: 'Alumno', isCreator: person === admin, status: person === removed ? 'removed' : 'active' }));
  const note = (id: bigint, visibility: string) => ({ id, subjectId: 1n, title: 'Apunte', topic: '', body: 'Contenido', tags: [], visibility, source: 'student', author, version: 1, createdAt: at, updatedAt: at });
  const initial: Record<string, Row[]> = {
    member, appConfig: [{ id: 0, owner: admin }], authConfig: [{ id: 0, issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', audiences: ['test'] }],
    subject: [{ id: 1n, name: 'Lógica' }], note: [note(1n, 'group'), note(2n, 'personal')],
    question: [{ id: 3n, author, subjectId: 1n, title: 'Pregunta', body: 'Texto', topic: '', createdAt: at, status: 'open' }],
    answer: [{ id: 4n, author, questionId: 3n, body: 'Respuesta', createdAt: at }],
  };
  const keys: Record<string, string> = { museumEntry: 'questionId', member: 'identity', contentStatus: 'key', noteDetail: 'noteId', resourceVersion: 'key', resourceFile: 'id', resourceUpload: 'id' };
  const tables = new Map<string, ReturnType<typeof store>>();
  const db = new Proxy({}, { get(_target, property: string) {
    if (!tables.has(property)) tables.set(property, store(keys[property] ?? 'id', initial[property]));
    return tables.get(property);
  } });
  const state = { db, sender: author, timestamp: at, env: {}, senderAuth: { jwt: { issuer: 'https://pypdkigeywdughdhxlcm.supabase.co/auth/v1', audience: ['test'], fullPayload: { email: 'alumno@example.com', email_verified: true } } } };
  return { ctx: state as unknown as Ctx, as: (sender: Identity) => { state.sender = sender; },
    rows: (table: string) => [...(db as Record<string, ReturnType<typeof store>>)[table].rows.values()],
    insert: (table: string, row: Row) => (db as Record<string, ReturnType<typeof store>>)[table].insert(row) };
}
const museum = { intention: 'Hacer un ciclo', symptom: 'No termina', cause: 'No avanza índice', correction: '', learning: 'Revisar incremento', minimalCode: 'while(i<10){}', evidence: '', language: 'JS', topic: 'Ciclos', bugType: 'Lógico', noteIds: [], questionIds: [] };
const opportunity = { kind: 'event', title: 'Taller', topic: 'Rust', modality: 'online', sourceUrl: 'https://example.com/event', organizer: 'Universidad', requirements: 'Inscribirse', costKnown: false, cost: '' };
describe('Museo sobre Preguntas existentes', () => {
  it('rechaza reutilizar creación o edición con contenido cambiado, aunque el original se haya editado', () => {
    const { ctx, rows } = setup(); const create = { subjectId: 1n, title: 'Ciclo infinito', fields: JSON.stringify(museum), requestId: 'creation' };
    c4.createMuseum(ctx, create); const questionId = rows('museumEntry')[0]!.questionId as bigint;
    const edit = { questionId, expectedVersion: 1, fields: JSON.stringify({ ...museum, correction: 'Incrementar' }), requestId: 'edition' };
    c4.saveMuseum(ctx, edit); expect(() => c4.createMuseum(ctx, create)).not.toThrow();
    expect(() => c4.createMuseum(ctx, { ...create, title: 'Otro error' })).toThrow('otro contenido');
    expect(() => c4.saveMuseum(ctx, { ...edit, fields: JSON.stringify(museum) })).toThrow('otro contenido');
    expect(rows('museumRevision')).toHaveLength(2);
  });
  it('crea una pregunta real, versiona metadata y no duplica al reintentar después de editar', () => {
    const {ctx, rows} = setup(); const create = {subjectId: 1n, title:'Ciclo infinito',fields:JSON.stringify(museum),requestId:'create-1'};
    c4.createMuseum(ctx,create); const id=rows('museumEntry')[0]!.questionId as bigint;
    expect(rows('question')).toHaveLength(2); expect(rows('museumRevision')).toHaveLength(1);
    c4.saveMuseum(ctx,{questionId:id,expectedVersion:1,fields:JSON.stringify({...museum,correction:'Incrementar i'}),requestId:'edit-1'});
    c4.createMuseum(ctx,create); expect(rows('question')).toHaveLength(2); expect(rows('museumRevision')).toHaveLength(2);
    expect(()=>c4.saveMuseum(ctx,{questionId:id,expectedVersion:1,fields:JSON.stringify(museum),requestId:'stale'})).toThrow('cambió');
  });
  it('edición propia, referencias compartidas y membresía activa se verifican en servidor',()=>{
    const {ctx,as}=setup(); const save={questionId:3n,expectedVersion:0,fields:JSON.stringify(museum),requestId:'save'};
    as(other);expect(()=>c4.saveMuseum(ctx,save)).toThrow('autor');as(author);
    expect(()=>c4.saveMuseum(ctx,{...save,fields:JSON.stringify({...museum,noteIds:['2']})})).toThrow('compartidas');
    expect(()=>c4.saveMuseum(ctx,{...save,fields:JSON.stringify({...museum,noteIds:['n1']})})).toThrow('referencia');
    as(removed);expect(()=>c4.saveMuseum(ctx,save)).toThrow('activo');
  });
  it('oculta museo e historial al retirar origen; restaura misma metadata y limpia al purgar',()=>{
    const {ctx,rows}=setup();c4.saveMuseum(ctx,{questionId:3n,expectedVersion:0,fields:JSON.stringify(museum),requestId:'save'});
    expect(c4.museumReadable(ctx.db,author,3n)).toBe(true);withdrawContent(ctx,{kind:'question',targetId:3n,withdrawn:true,expectedVersion:1,reason:''});
    expect(c4.museumReadable(ctx.db,author,3n)).toBe(false);expect(rows('museumEntry')).toHaveLength(1);
    withdrawContent(ctx,{kind:'question',targetId:3n,withdrawn:false,expectedVersion:2,reason:''});expect(c4.museumReadable(ctx.db,author,3n)).toBe(true);
    c4.purgeMuseum(ctx.db,'question',3n);expect(rows('museumEntry')).toHaveLength(0);expect(rows('museumRevision')).toHaveLength(0);
  });
});
describe('Radar manual y participación voluntaria',()=>{
  it('creación idempotente, autoría y versiones independientes del historial',()=>{
    const {ctx,rows,as}=setup();const input={fields:JSON.stringify(opportunity),requestId:'create'};c4.createOpportunity(ctx,input);c4.createOpportunity(ctx,input);
    expect(rows('opportunity')).toHaveLength(1);const id=rows('opportunity')[0]!.id as bigint;
    as(other);expect(()=>c4.updateOpportunity(ctx,{opportunityId:id,fields:input.fields,expectedVersion:1})).toThrow('autor');as(author);
    c4.updateOpportunity(ctx,{opportunityId:id,fields:JSON.stringify({...opportunity,title:'Corregido'}),expectedVersion:1});expect(rows('opportunityRevision')).toHaveLength(2);
    expect(()=>c4.updateOpportunity(ctx,{opportunityId:id,fields:input.fields,expectedVersion:1})).toThrow('cambió');
  });
  it('interés privado aun para autor/admin; sólo búsqueda y permiso expresos hacen visible contacto',()=>{
    const {ctx,rows,as}=setup();c4.createOpportunity(ctx,{fields:JSON.stringify(opportunity),requestId:'create'});const id=rows('opportunity')[0]!.id as bigint;as(other);
    c4.setOpportunityInterest(ctx,{opportunityId:id,interested:true,seekingTeam:false,shareContact:true,expectedVersion:0});let interest=rows('opportunityInterest')[0] as never;
    expect(c4.interestReadable(ctx.db,author,interest)).toBe(false);expect(c4.interestReadable(ctx.db,admin,interest)).toBe(false);
    c4.setOpportunityInterest(ctx,{opportunityId:id,interested:true,seekingTeam:true,shareContact:true,expectedVersion:1});interest=rows('opportunityInterest')[0] as never;expect(c4.interestReadable(ctx.db,author,interest)).toBe(true);
    c4.setOpportunityInterest(ctx,{opportunityId:id,interested:false,seekingTeam:true,shareContact:true,expectedVersion:2});expect(rows('opportunityInterest')[0]).toMatchObject({interested:false,seekingTeam:false,shareContact:false});
  });
  it('plazo vencido bloquea nuevas altas pero permite cancelar interés anterior',()=>{
    const {ctx,rows}=setup();c4.createOpportunity(ctx,{fields:JSON.stringify({...opportunity,deadline:'2000-01-01T12:00:00Z'}),requestId:'expired'});const id=rows('opportunity')[0]!.id as bigint;
    expect(()=>c4.setOpportunityInterest(ctx,{opportunityId:id,interested:true,seekingTeam:false,shareContact:false,expectedVersion:0})).toThrow('vencida');c4.setOpportunityInterest(ctx,{opportunityId:id,interested:false,seekingTeam:false,shareContact:false,expectedVersion:0});
  });
  it('correcciones y reportes tienen autor y resolución con versión por autor/admin',()=>{
    const {ctx,rows,as}=setup();c4.createOpportunity(ctx,{fields:JSON.stringify(opportunity),requestId:'create'});const id=rows('opportunity')[0]!.id as bigint;as(other);
    const input={opportunityId:id,kind:'broken_link',text:'El enlace devuelve 404',requestId:'report'};c4.sendOpportunityFeedback(ctx,input);c4.sendOpportunityFeedback(ctx,input);expect(rows('opportunityFeedback')).toHaveLength(1);const feedbackId=rows('opportunityFeedback')[0]!.id as bigint;
    expect(() => c4.sendOpportunityFeedback(ctx, { ...input, text: 'Otra corrección' })).toThrow('otro contenido');
    expect(()=>c4.resolveOpportunityFeedback(ctx,{feedbackId,expectedVersion:1,resolution:'Ya funciona'})).toThrow('autor');as(admin);
    c4.resolveOpportunityFeedback(ctx,{feedbackId,expectedVersion:1,resolution:'Se actualizó la fuente'});expect(rows('opportunityFeedback')[0]).toMatchObject({status:'resolved',version:2,resolvedBy:admin});
  });
  it('retirada conserva versiones, oculta al grupo y una moderación requiere restauración admin',()=>{
    const {ctx,rows,as}=setup();c4.createOpportunity(ctx,{fields:JSON.stringify(opportunity),requestId:'create'});const id=rows('opportunity')[0]!.id as bigint;as(admin);
    expect(()=>c4.withdrawOpportunity(ctx,{opportunityId:id,withdrawn:true,expectedVersion:1,reason:''})).toThrow('motivo');c4.withdrawOpportunity(ctx,{opportunityId:id,withdrawn:true,expectedVersion:1,reason:'Fuente incorrecta'});
    expect(c4.opportunityReadable(ctx.db,other,id)).toBe(false);expect(c4.opportunityReadable(ctx.db,author,id)).toBe(true);as(author);
    expect(()=>c4.withdrawOpportunity(ctx,{opportunityId:id,withdrawn:false,expectedVersion:2,reason:''})).toThrow('administrador');as(admin);c4.withdrawOpportunity(ctx,{opportunityId:id,withdrawn:false,expectedVersion:2,reason:''});expect(rows('opportunityRevision')).toHaveLength(3);
  });
});

describe('Oportunidades e intención de creación', () => {
  it('compara el reintento con la primera revisión y rechaza otro contenido con la misma clave', () => {
    const { ctx, rows } = setup(); const create = { fields: JSON.stringify(opportunity), requestId: 'creation' };
    c4.createOpportunity(ctx, create); const opportunityId = rows('opportunity')[0]!.id as bigint;
    c4.updateOpportunity(ctx, { opportunityId, expectedVersion: 1, fields: JSON.stringify({ ...opportunity, title: 'Corregido' }) });
    expect(() => c4.createOpportunity(ctx, create)).not.toThrow();
    expect(() => c4.createOpportunity(ctx, { ...create, fields: JSON.stringify({ ...opportunity, title: 'Otra intención' }) })).toThrow('otro contenido');
    expect(rows('opportunity')).toHaveLength(1); expect(rows('opportunityRevision')).toHaveLength(2);
  });
});
