import { createContext } from 'react';
import type { SessionStore } from './session';

export interface AuthValue {
  store: SessionStore;
  busy: boolean;
}
export const AuthContext = createContext<AuthValue | null>(null);
