import { AGENT_AI_STEPS, AGENT_LIMITS, AGENT_PREMISES_VERSION, agentAiSystemInstruction, agentName, agentOwnerName, buildAgentAiPayload, estimateAgentAiTokens, applyAgentSuggestion, cleanAgentDraft, cleanAgentSources, cleanAgentStage, cleanAgentSuggestions, describeStyle, proseSentences, styleFeatures, type AgentAiStep, type AgentSourceKind } from '@b20/core';
import { agentOriginality } from './agentDemo';
import type { Id, Member, Snapshot } from './types';
import { emptyAgent, type AgentActions, type AgentAiActions, type AgentAiPreview, type AgentSnapshot } from './agentTypes';

/** Simulación en memoria con las mismas reglas que `agentHandlers.ts` del módulo. */
interface Context { state(): object; active(): Member; current(): Snapshot; id(): string; now(): Date; emit(): void }
type Owned = AgentSnapshot & { agentProfile: AgentSnapshot['agentProfile'] };
const stores = new WeakMap<object, Map<Id, Owned>>();
const DAY_MS = 86_400_000;
const version = (actual: number, expected: number) => { if (actual !== expected) throw new Error('El contenido cambió. Actualiza antes de guardar.'); };

export class DemoAgentStore implements AgentActions, AgentAiActions {
  constructor(private ctx: Context) {}
  private get all() { let map = stores.get(this.ctx.state()); if (!map) { map = new Map(); stores.set(this.ctx.state(), map); } return map; }
  private mine(memberId = this.ctx.active().id) { let data = this.all.get(memberId); if (!data) { data = emptyAgent(); this.all.set(memberId, data); } return data; }
  private profiled() { const data = this.mine(); if (!data.agentProfile) throw new Error('Activa tu agente y acepta sus premisas antes de usarlo.'); return data; }
  private session(id: Id) { const data = this.profiled(); const row = data.agentSessions.find((s) => s.id === id); if (!row) throw new Error('La sesión no existe.'); return { data, row }; }
  private touch(row: AgentSnapshot['agentSessions'][number]) { row.updatedAt = this.ctx.now(); }

  snapshot(base: Snapshot): AgentSnapshot {
    if (base.me?.status !== 'active') return emptyAgent();
    const data = this.all.get(base.me.id); if (!data) return emptyAgent();
    const limit = this.ctx.now().getTime() - AGENT_LIMITS.sessionRetentionDays * DAY_MS;
    for (const s of data.agentSessions.filter((row) => row.updatedAt.getTime() < limit)) this.dropSession(data, s.id);
    return structuredClone(data);
  }

  private ownText(kind: AgentSourceKind, refId: Id) {
    const base = this.ctx.current(); const me = this.ctx.active().id;
    if (kind === 'work') { const row = base.works.find((w) => w.id === refId); if (!row || row.withdrawnAt) throw new Error('Una fuente del estilo está retirada.'); if (!row.authorIds.includes(me)) throw new Error('Solo puedes usar trabajos de los que eres autor.'); return { text: row.description, refVersion: row.version }; }
    if (kind === 'evidence') { const row = base.evidences.find((e) => e.id === refId); if (!row || row.withdrawnAt) throw new Error('Una fuente del estilo está retirada.'); if (row.authorId !== me) throw new Error('Solo puedes usar evidencias que publicaste.'); return { text: row.content, refVersion: row.version ?? 1 }; }
    const row = base.notes.find((n) => n.id === refId); if (!row || row.withdrawnAt) throw new Error('Una fuente del estilo está retirada.');
    if (row.authorId !== me || row.source !== 'student') throw new Error('Solo puedes usar notas que escribiste.'); return { text: row.body, refVersion: row.version };
  }

  enableAgent(input: { premisesVersion: number }) {
    this.ctx.active(); if (input.premisesVersion !== AGENT_PREMISES_VERSION) throw new Error('Las premisas cambiaron. Léelas de nuevo antes de aceptar.');
    const data = this.mine(); const current = data.agentProfile;
    data.agentProfile = { premisesVersion: input.premisesVersion, consentAt: this.ctx.now(), styleVersion: current?.styleVersion ?? 0, version: (current?.version ?? 0) + 1 }; this.ctx.emit();
  }
  disableAgent() { this.all.delete(this.ctx.active().id); this.ctx.emit(); }
  trainAgent(input: Parameters<AgentActions['trainAgent']>[0]) {
    const data = this.profiled(); version(data.agentProfile!.styleVersion, input.expectedStyleVersion);
    const used = cleanAgentSources(input.sources).map((ref) => ({ ...ref, ...this.ownText(ref.kind, ref.refId) }));
    const texts = used.map((ref) => ref.text); const features = styleFeatures(texts); const next = data.agentProfile!.styleVersion + 1;
    data.agentSources = used.map(({ kind, refId, refVersion }) => ({ kind, refId, refVersion }));
    data.agentStyleSnapshots = [...data.agentStyleSnapshots, { id: this.ctx.id(), version: next, features: { ...features, ...describeStyle(features) }, examples: texts.flatMap(proseSentences).slice(0, 2), sources: data.agentSources, createdAt: this.ctx.now() }].slice(-AGENT_LIMITS.snapshotsKept);
    data.agentProfile = { ...data.agentProfile!, styleVersion: next, version: data.agentProfile!.version + 1 }; this.ctx.emit();
  }
  startAgentSession(input: { assignmentId: Id; requestId: string }) {
    const data = this.profiled(); const requestId = input.requestId.trim(); if (!requestId || requestId.length > 128) throw new Error('La solicitud no es válida.');
    const prior = data.agentSessions.find((s) => s.requestId === requestId);
    if (prior) { if (prior.assignmentId !== input.assignmentId) throw new Error('Este envío ya se utilizó para otra tarea.'); return; }
    if (!this.ctx.current().assignments.some((a) => a.id === input.assignmentId)) throw new Error('La tarea no existe.');
    const now = this.ctx.now(); data.agentSessions.push({ id: this.ctx.id(), assignmentId: input.assignmentId, requestId, stage: 'understand', draft: '', draftVersion: 0, createdAt: now, updatedAt: now }); this.ctx.emit();
  }
  saveAgentDraft(input: Parameters<AgentActions['saveAgentDraft']>[0]) {
    const { row } = this.session(input.sessionId); version(row.draftVersion, input.expectedDraftVersion);
    const stage = cleanAgentStage(input.stage); const draft = cleanAgentDraft(input.draft); if (draft === row.draft && stage === row.stage) return;
    if (draft !== row.draft) row.draftVersion++; row.draft = draft; row.stage = stage; this.touch(row); this.ctx.emit();
  }
  private dropSession(data: AgentSnapshot, id: Id) {
    data.agentSessions = data.agentSessions.filter((s) => s.id !== id); data.agentSuggestions = data.agentSuggestions.filter((s) => s.sessionId !== id); data.agentOriginalityChecks = data.agentOriginalityChecks.filter((c) => c.sessionId !== id);
  }
  deleteAgentSession(input: { sessionId: Id }) { const { data } = this.session(input.sessionId); this.dropSession(data, input.sessionId); this.ctx.emit(); }
  proposeAgentSuggestions(input: Parameters<AgentActions['proposeAgentSuggestions']>[0]) {
    const { data, row } = this.session(input.sessionId); version(row.draftVersion, input.draftVersion);
    const suggestions = cleanAgentSuggestions(input.suggestions, row.draft);
    data.agentSuggestions = [...data.agentSuggestions.filter((s) => s.sessionId !== row.id || s.state !== 'proposed'), ...suggestions.map((s) => ({ ...s, id: this.ctx.id(), sessionId: row.id, draftVersion: row.draftVersion, state: 'proposed' as const, createdAt: this.ctx.now() }))];
    this.touch(row); this.ctx.emit();
  }
  resolveAgentSuggestion(input: { suggestionId: Id; accept: boolean }) {
    const data = this.mine(); const suggestion = data.agentSuggestions.find((s) => s.id === input.suggestionId); if (!suggestion) throw new Error('La sugerencia no existe.');
    if (suggestion.state !== 'proposed') return;
    const { row } = this.session(suggestion.sessionId); const accept = input.accept && !!suggestion.original;
    if (accept) { if (suggestion.draftVersion !== row.draftVersion) throw new Error('El borrador cambió y la sugerencia ya no aplica.'); row.draft = applyAgentSuggestion(row.draft, suggestion); row.draftVersion++; this.touch(row); }
    suggestion.state = accept ? 'accepted' : 'rejected'; this.ctx.emit();
  }
  checkAgentOriginality(input: { sessionId: Id; draftVersion: number }) {
    const { data, row } = this.session(input.sessionId); version(row.draftVersion, input.draftVersion); if (!row.draft.trim()) throw new Error('Escribe tu borrador antes de compararlo.');
    const base = this.ctx.current(); const assignment = base.assignments.find((a) => a.id === row.assignmentId);
    data.agentOriginalityChecks.push({ id: this.ctx.id(), sessionId: row.id, draftVersion: row.draftVersion, matches: agentOriginality(row.draft, base, assignment), acknowledged: [], createdAt: this.ctx.now() });
    const kept = new Set(data.agentOriginalityChecks.filter((c) => c.sessionId === row.id).slice(-AGENT_LIMITS.checksKept));
    data.agentOriginalityChecks = data.agentOriginalityChecks.filter((c) => c.sessionId !== row.id || kept.has(c));
    this.touch(row); this.ctx.emit();
  }
  acknowledgeAgentMatch(input: { checkId: Id; refKey: string }) {
    const check = this.mine().agentOriginalityChecks.find((c) => c.id === input.checkId); if (!check) throw new Error('La comparación no existe.');
    if (!check.matches.some((m) => m.refKey === input.refKey)) throw new Error('Esa coincidencia no está en la comparación.');
    if (!check.acknowledged.includes(input.refKey)) check.acknowledged.push(input.refKey); this.ctx.emit();
  }
  /** En la demostración Gemini queda apagado; la vista previa sí muestra lo que se enviaría. */
  getAgentAiStatus() { return Promise.resolve(AGENT_AI_STEPS.map((step) => ({ step, enabled: false }))); }
  async previewAgentAi(input: { step: AgentAiStep; sessionId?: Id }): Promise<AgentAiPreview> {
    const data = this.profiled(); const base = this.ctx.current(); const me = this.ctx.active(); const style = data.agentStyleSnapshots.at(-1);
    const session = input.sessionId ? this.session(input.sessionId).row : undefined; const assignment = base.assignments.find((a) => a.id === session?.assignmentId);
    const check = data.agentOriginalityChecks.filter((c) => c.sessionId === session?.id).at(-1);
    if (input.step === 'originality' && check?.draftVersion !== session?.draftVersion) throw new Error('Compara tu borrador actual antes de pedir la explicación.');
    const payload = buildAgentAiPayload(input.step, { owner: agentOwnerName(me.displayName), bot: agentName(me, base.members.filter((m) => m.status === 'active')),
      style: style && { features: style.features, examples: style.examples }, assignment: assignment && { title: assignment.title, instructions: assignment.instructions },
      draft: session?.draft, matches: check?.matches.filter((m) => !check.acknowledged.includes(m.refKey)) });
    return { step: input.step, payload, systemInstruction: agentAiSystemInstruction(payload), estimatedTokens: estimateAgentAiTokens(payload) };
  }
  runAgentAiStep(): Promise<never> { return Promise.reject(new Error('En la demostración Gemini está apagado: no se envía nada ni se usa tu clave.')); }
  listAgentAiRuns() { return Promise.resolve([]); }
  /** Contenido purgado: deja de ser fuente y desaparece de las comparaciones. */
  purgeSource(kind: string, id: Id) {
    const refKey = `${kind}:${id}`;
    for (const data of this.all.values()) {
      data.agentSources = data.agentSources.filter((s) => `${s.kind}:${s.refId}` !== refKey);
      for (const check of data.agentOriginalityChecks) { check.matches = check.matches.filter((m) => m.refKey !== refKey); check.acknowledged = check.acknowledged.filter((k) => k !== refKey); }
    }
  }
  purgeOwner(memberId: Id) { this.all.delete(memberId); }
}
