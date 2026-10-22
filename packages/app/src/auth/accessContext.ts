import { createContext } from 'react';
import type { SessionStore } from './session';

export interface SignInOptions { loginHint?: string }
export interface AuthValue {
  store: SessionStore;
  signIn: (options?: SignInOptions) => void;
  busy: boolean;
}
export const AuthContext = createContext<AuthValue | null>(null);
