/**
 * Tipos de datos que usa la interfaz. Reflejan las vistas del módulo SpacetimeDB
 * (`packages/spacetime-module`), con identidades e ids como texto para simplificar la UI.
 */

export type Id = string;

export interface Member {
  id: Id;
  displayName: string;
  photoUrl?: string;
  status: 'active' | 'removed';
  isCreator: boolean;
  joinedAt: Date;
}

export interface Subject {
  id: Id;
  name: string;
}

/** Parcial o unidad. */
export interface Term {
  id: Id;
  subjectId: Id;
  name: string;
  position: number;
}

export interface Work {
  id: Id;
  subjectId: Id;
  termId?: Id;
  title: string;
  assignment: string;
  description: string;
  version: number;
  authorIds: Id[];
  createdAt: Date;
  updatedAt: Date;
}

export interface GroupMessage {
  id: Id;
  senderId: Id;
  text: string;
  sentAt: Date;
}

export interface DirectConversation {
  id: Id;
  participantIds: [Id, Id];
}

export interface DirectMessage {
  id: Id;
  conversationId: Id;
  senderId: Id;
  text: string;
  sentAt: Date;
}

export interface Birthday {
  memberId: Id;
  day: number;
  month: number;
  remind: boolean;
}

/** Lo que el usuario actual puede ver, igual que las vistas del servidor. */
export interface Snapshot {
  me: Member | undefined;
  members: Member[];
  subjects: Subject[];
  terms: Term[];
  works: Work[];
  groupMessages: GroupMessage[];
  directConversations: DirectConversation[];
  directMessages: DirectMessage[];
  birthdays: Birthday[];
}

export interface PublishWorkInput {
  subjectId: Id;
  termId?: Id;
  title: string;
  assignment: string;
  description: string;
  coauthorIds: Id[];
}

/** Acciones: corresponden uno a uno con los reducers del módulo. */
export interface Actions {
  updateProfile(displayName: string, photoUrl?: string): void;
  createSubject(name: string): Id;
  createTerm(subjectId: Id, name: string): Id;
  publishWork(input: PublishWorkInput): Id;
  sendGroupMessage(text: string): void;
  /** Devuelve la conversación existente o la nueva. */
  openDirectConversation(otherId: Id): Id;
  sendDirectMessage(conversationId: Id, text: string): void;
  shareBirthday(day: number, month: number, remind: boolean): void;
  withdrawBirthday(): void;
}

export interface DataSource extends Actions {
  /** Nombre visible de la fuente, por ejemplo «Datos de prueba». */
  readonly label: string;
  getSnapshot(): Snapshot;
  subscribe(listener: () => void): () => void;
}
