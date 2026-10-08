import { createContext, useContext } from 'react';
import type { Platform } from '../platform';

export const PlatformContext = createContext<Platform>('web');

export function usePlatform(): Platform {
  return useContext(PlatformContext);
}
