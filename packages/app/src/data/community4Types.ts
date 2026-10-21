import type { MuseumFields, OpportunityFields } from '@b20/core';
import type { Id, MaybePromise } from './types';
export interface MuseumEntry extends MuseumFields { questionId: Id; authorId: Id; requestId: string; version: number; updatedBy: Id; createdAt: Date; updatedAt: Date; }
export interface MuseumRevision { id: Id; questionId: Id; fields: MuseumFields; version: number; updatedBy: Id; createdAt: Date; }
export interface Opportunity extends OpportunityFields { id: Id; authorId: Id; requestId: string; withdrawn: boolean; withdrawalReason: string; version: number; updatedBy: Id; createdAt: Date; updatedAt: Date; }
export interface OpportunityRevision { id: Id; opportunityId: Id; fields: OpportunityFields; withdrawn: boolean; version: number; updatedBy: Id; createdAt: Date; }
export interface OpportunityInterest { opportunityId: Id; memberId: Id; interested: boolean; seekingTeam: boolean; shareContact: boolean; version: number; updatedAt: Date; }
export interface OpportunityFeedback { id: Id; opportunityId: Id; authorId: Id; kind: 'correction' | 'broken_link' | 'outdated'; text: string; status: 'open' | 'resolved'; resolution: string; resolvedBy?: Id; version: number; createdAt: Date; updatedAt: Date; }
export interface Community4Snapshot { museumEntries: MuseumEntry[]; museumRevisions: MuseumRevision[]; opportunities: Opportunity[]; opportunityRevisions: OpportunityRevision[]; opportunityInterests: OpportunityInterest[]; opportunityFeedback: OpportunityFeedback[]; }
export interface Community4Actions {
  createMuseum(input: { subjectId: Id; title: string; fields: MuseumFields; requestId: string }): MaybePromise<void>;
  saveMuseum(input: { questionId: Id; expectedVersion: number; fields: MuseumFields; requestId: string }): MaybePromise<void>;
  createOpportunity(input: { fields: OpportunityFields; requestId: string }): MaybePromise<void>;
  updateOpportunity(input: { opportunityId: Id; expectedVersion: number; fields: OpportunityFields }): MaybePromise<void>;
  withdrawOpportunity(input: { opportunityId: Id; expectedVersion: number; withdrawn: boolean; reason: string }): MaybePromise<void>;
  setOpportunityInterest(input: { opportunityId: Id; interested: boolean; seekingTeam: boolean; shareContact: boolean; expectedVersion: number }): MaybePromise<void>;
  sendOpportunityFeedback(input: { opportunityId: Id; kind: OpportunityFeedback['kind']; text: string; requestId: string }): MaybePromise<void>;
  resolveOpportunityFeedback(input: { feedbackId: Id; expectedVersion: number; resolution: string }): MaybePromise<void>;
}
export function emptyCommunity4(): Community4Snapshot { return { museumEntries: [], museumRevisions: [], opportunities: [], opportunityRevisions: [], opportunityInterests: [], opportunityFeedback: [] }; }
