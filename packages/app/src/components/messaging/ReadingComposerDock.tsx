import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import './readingComposerDock.css';

export interface ReadingComposerControl {
  hidden: boolean;
  reveal(focus?: boolean): void;
  setLocked(owner: string, locked: boolean): void;
  registerInput(input: HTMLTextAreaElement | null): void;
}

const ReadingComposerContext = createContext<ReadingComposerControl | null>(null);

/** Composers outside the conversation layout do not need a reading dock. */
export const useReadingComposer = () => useContext(ReadingComposerContext);

export interface ReadingComposerDockState {
  hidden: boolean;
  locked: boolean;
  ref: RefObject<HTMLDivElement | null>;
  control: ReadingComposerControl;
  onVisibilityChange(hidden: boolean, focus?: boolean, history?: HTMLElement): boolean;
}

/** This state belongs to one account/conversation, independent of its draft and uploads. */
export function useReadingComposerDock(conversationKey: string, onHidden: () => void): ReadingComposerDockState {
  const [visibility, setVisibility] = useState({ key: conversationKey, hidden: false });
  const [lockedState, setLockedState] = useState({ key: conversationKey, locked: false });
  const currentKey = useRef(conversationKey); currentKey.current = conversationKey;
  const hidden = visibility.key === conversationKey && visibility.hidden;
  const locked = lockedState.key === conversationKey && lockedState.locked;
  const visibilityRef = useRef({ key: conversationKey, hidden });
  visibilityRef.current = { key: conversationKey, hidden };
  const locks = useRef({ key: conversationKey, owners: new Set<string>() });
  if (locks.current.key !== conversationKey) locks.current = { key: conversationKey, owners: new Set() };
  const input = useRef<HTMLTextAreaElement | null>(null);
  const lastHistory = useRef<HTMLElement | undefined>(undefined);
  const ref = useRef<HTMLDivElement | null>(null);
  const latestHidden = useRef(onHidden); latestHidden.current = onHidden;
  const focusFrame = useRef<number | undefined>(undefined);

  const focusInput = useCallback(() => {
    if (focusFrame.current !== undefined) cancelAnimationFrame(focusFrame.current);
    focusFrame.current = requestAnimationFrame(() => {
      focusFrame.current = undefined;
      if (currentKey.current !== conversationKey || visibilityRef.current.hidden) return;
      const target = input.current && !input.current.disabled ? input.current
        : ref.current?.querySelector<HTMLElement>('form button:not(:disabled),form a[href],form select:not(:disabled)') ?? lastHistory.current;
      target?.focus({ preventScroll: true });
    });
  }, [conversationKey]);

  const onVisibilityChange = useCallback((nextHidden: boolean, focus = false, history?: HTMLElement) => {
    if (currentKey.current !== conversationKey) return false;
    if (history) lastHistory.current = history;
    if (nextHidden && locks.current.owners.size) return false;
    const previous = visibilityRef.current.hidden;
    if (nextHidden !== previous) {
      if (nextHidden) {
        if (focusFrame.current !== undefined) cancelAnimationFrame(focusFrame.current);
        focusFrame.current = undefined;
        const active = document.activeElement;
        if (active instanceof HTMLElement && ref.current?.contains(active)) {
          active.blur();
          history?.focus({ preventScroll: true });
        }
        latestHidden.current();
      }
      visibilityRef.current = { key: conversationKey, hidden: nextHidden };
      setVisibility({ key: conversationKey, hidden: nextHidden });
    }
    if (!nextHidden && focus) focusInput();
    return true;
  }, [conversationKey, focusInput]);

  const reveal = useCallback((focus = false) => { onVisibilityChange(false, focus); }, [onVisibilityChange]);
  const setLocked = useCallback((owner: string, value: boolean) => {
    if (currentKey.current !== conversationKey) return;
    if (value) locks.current.owners.add(owner); else locks.current.owners.delete(owner);
    const next = locks.current.owners.size > 0;
    setLockedState(previous => previous.key === conversationKey && previous.locked === next ? previous : { key: conversationKey, locked: next });
    if (next) reveal();
  }, [conversationKey, reveal]);
  const registerInput = useCallback((element: HTMLTextAreaElement | null) => {
    if (currentKey.current === conversationKey) input.current = element;
  }, [conversationKey]);

  useEffect(() => () => {
    if (focusFrame.current !== undefined) cancelAnimationFrame(focusFrame.current);
  }, [conversationKey]);

  const control = useMemo(() => ({ hidden, reveal, setLocked, registerInput }), [hidden, reveal, setLocked, registerInput]);
  return { hidden, locked, ref, control, onVisibilityChange };
}

export function ReadingComposerProvider({ state, children }: { state: ReadingComposerDockState; children: ReactNode }) {
  return <ReadingComposerContext value={state.control}>{children}</ReadingComposerContext>;
}

/** Grid collapse frees history space while retaining the compositor's exact mounted state. */
export function ReadingComposerDock({ state, children }: { state: ReadingComposerDockState; children: ReactNode }) {
  return <div ref={state.ref} className="reading-composer-dock" data-hidden={state.hidden || undefined} aria-hidden={state.hidden || undefined} inert={state.hidden}>
    <div className="reading-composer-dock__contents">{children}</div>
  </div>;
}
