import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export const READING_DIRECTION_THRESHOLD = 12;
export const READING_NEAR_BOTTOM = 80;
interface ViewState { away: boolean; unseen: number }
interface ReadingOptions {
  hidden: boolean;
  locked: boolean;
  changeVisibility?: (hidden: boolean, focus?: boolean, history?: HTMLElement) => boolean | void;
}
interface Anchor { node?: HTMLElement; offset: number; top: number }

/** The history owns scroll geometry; a changing composer never becomes a user gesture. */
export class ReadingScrollController {
  private followLatest = true;
  private state: ViewState = { away: false, unseen: 0 };
  private previousTop = 0;
  private direction = 0;
  private accumulated = 0;
  private intentUntil = 0;
  private programmaticUntil = 0;
  private expectedTop?: number;
  private touch?: { x: number; y: number };
  private dragging = false;
  private anchor: Anchor = { offset: 0, top: 0 };
  private compensation = 0;
  private height = 0;
  private width = 0;
  private naturalHeight = 0;
  private observer?: ResizeObserver;
  private observed = new Set<Element>();
  private seenCount: number;
  private lastId?: string;
  private oldOverflowAnchor: string;
  private disposed = false;

  constructor(private root: HTMLElement, private spacer: HTMLElement, private options: () => ReadingOptions,
    private notify: (state: ViewState) => void, count: number, lastId?: string) {
    this.seenCount = count; this.lastId = lastId;
    this.oldOverflowAnchor = root.style.overflowAnchor;
    root.style.overflowAnchor = 'none';
    root.addEventListener('wheel', this.wheel, { passive: true });
    root.addEventListener('touchstart', this.touchStart, { passive: true });
    root.addEventListener('touchmove', this.touchMove, { passive: true });
    root.addEventListener('touchend', this.touchEnd, { passive: true });
    root.addEventListener('touchcancel', this.touchEnd, { passive: true });
    root.addEventListener('keydown', this.keyDown);
    root.addEventListener('pointerdown', this.pointerDown);
    root.addEventListener('scroll', this.scrolled, { passive: true });
    window.addEventListener('pointerup', this.pointerUp);
    window.addEventListener('pointercancel', this.pointerUp);
    window.addEventListener('resize', this.layoutChanged);
    if (typeof ResizeObserver !== 'undefined') this.observer = new ResizeObserver(this.layoutChanged);
    this.refreshObserved();
    this.writeBottom();
  }

  private now() { return Date.now(); }
  private top() { return Math.max(0, Math.min(this.root.scrollTop, Math.max(0, this.root.scrollHeight - this.root.clientHeight))); }
  private metricsChanged() {
    return this.height !== this.root.clientHeight || this.width !== this.root.clientWidth || Math.abs(this.naturalHeight - (this.root.scrollHeight - this.compensation)) > 1;
  }
  private updateMetrics() {
    this.height = this.root.clientHeight; this.width = this.root.clientWidth;
    this.naturalHeight = this.root.scrollHeight - this.compensation;
  }
  private update(value: Partial<ViewState>) {
    const next = { ...this.state, ...value };
    if (next.away === this.state.away && next.unseen === this.state.unseen) return;
    this.state = next; this.notify(next);
  }
  private captureAnchor() {
    const viewport = this.root.getBoundingClientRect();
    const node = [...this.root.querySelectorAll<HTMLElement>('[data-message-id]')].find(item => {
      const box = item.getBoundingClientRect(); return box.bottom > viewport.top + 1 && box.top < viewport.bottom;
    });
    this.anchor = { node, offset: node ? node.getBoundingClientRect().top - viewport.top : 0, top: this.top() };
  }
  private setTop(value: number) {
    this.root.scrollTop = Math.max(0, value);
    this.previousTop = this.top(); this.expectedTop = this.previousTop;
    this.updateMetrics();
  }
  private setCompensation(value: number) {
    const next = Math.max(0, Math.ceil(value));
    if (next === this.compensation) return;
    this.compensation = next; this.spacer.style.height = `${next}px`;
  }
  private preserveAnchor() {
    if (this.disposed) return;
    if (this.followLatest) { this.writeBottom(); return; }
    const natural = this.root.scrollHeight - this.compensation;
    const node = this.anchor.node;
    const anchored = node?.isConnected && this.root.contains(node);
    let target = anchored && node
      ? this.root.scrollTop + node.getBoundingClientRect().top - this.root.getBoundingClientRect().top - this.anchor.offset
      : Math.min(this.anchor.top, Math.max(0, natural - this.root.clientHeight));
    // A larger viewport can clamp scrollTop before the resize observer runs. The
    // smallest necessary spacer keeps the same message in place, then shrinks away.
    this.setCompensation(Math.max(0, target + this.root.clientHeight - natural));
    // With short histories the first flex child's auto margin also moves when the
    // viewport grows. Measure again after compensating, then retain one gesture's
    // travel so reversing direction can reopen the composer even at the old top.
    if (anchored && node) target = this.root.scrollTop + node.getBoundingClientRect().top - this.root.getBoundingClientRect().top - this.anchor.offset;
    const travel = this.options().hidden ? READING_DIRECTION_THRESHOLD : 0;
    const actualNatural = this.root.scrollHeight - this.compensation;
    this.setCompensation(Math.max(0, target + this.root.clientHeight + travel - actualNatural));
    this.setTop(target);
  }
  private writeBottom() {
    this.setCompensation(0); this.setTop(this.root.scrollHeight);
    this.captureAnchor();
  }
  private refreshObserved() {
    if (!this.observer) return;
    const nodes = new Set<Element>([this.root, ...this.root.querySelectorAll('[data-message-id]')]);
    for (const node of this.observed) if (!nodes.has(node)) this.observer.unobserve(node);
    for (const node of nodes) if (!this.observed.has(node)) this.observer.observe(node);
    this.observed = nodes;
  }
  private arm() {
    if (this.disposed) return;
    const fresh = this.now() > this.intentUntil || this.programmaticUntil > this.now();
    if (fresh) {
      this.previousTop = this.top(); this.captureAnchor(); this.updateMetrics();
      this.direction = 0; this.accumulated = 0;
    }
    if (this.programmaticUntil > this.now()) this.root.scrollTop = this.root.scrollTop;
    this.programmaticUntil = 0; this.expectedTop = undefined;
    this.intentUntil = this.now() + 1200;
  }
  private wheel = (event: WheelEvent) => {
    if (!event.ctrlKey && Math.abs(event.deltaY) > Math.abs(event.deltaX)) this.arm();
  };
  private touchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1) { this.touch = undefined; return; }
    this.touch = { x: event.touches[0]!.clientX, y: event.touches[0]!.clientY };
  };
  private touchMove = (event: TouchEvent) => {
    const point = event.touches[0];
    if (!this.touch || event.touches.length !== 1 || !point) return;
    if (Math.abs(point.clientY - this.touch.y) > Math.abs(point.clientX - this.touch.x)) this.arm();
    this.touch = { x: point.clientX, y: point.clientY };
  };
  private touchEnd = () => { this.touch = undefined; };
  private keyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (event.ctrlKey || event.metaKey || event.altKey || target?.closest('input,textarea,select,[contenteditable="true"]')) return;
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) this.arm();
  };
  private pointerDown = (event: PointerEvent) => {
    if (event.pointerType === 'touch' || event.button !== 0) return;
    const bounds = this.root.getBoundingClientRect();
    const gutter = Math.max(16, this.root.offsetWidth - this.root.clientWidth);
    if (event.clientX >= bounds.right - gutter) { this.dragging = true; this.arm(); }
  };
  private pointerUp = () => { this.dragging = false; };
  private layoutChanged = () => {
    if (this.disposed) return;
    if (!this.followLatest && this.programmaticUntil > this.now()) { this.captureAnchor(); this.updateMetrics(); return; }
    this.preserveAnchor();
  };
  private scrolled = () => {
    if (this.disposed) return;
    if (this.metricsChanged()) { this.layoutChanged(); return; }
    const top = this.top();
    if (this.expectedTop !== undefined && Math.abs(top - this.expectedTop) < 1) {
      this.previousTop = top; this.expectedTop = undefined; return;
    }
    const delta = top - this.previousTop; this.previousTop = top;
    if (this.programmaticUntil > this.now() || (!this.dragging && this.now() > this.intentUntil)) { this.captureAnchor(); return; }
    if (Math.abs(delta) < .5) return;
    this.intentUntil = this.now() + 1200;
    const direction = Math.sign(delta);
    if (direction !== this.direction) { this.direction = direction; this.accumulated = 0; }
    this.accumulated += Math.abs(delta);
    const near = this.root.scrollHeight - this.compensation - top - this.root.clientHeight <= READING_NEAR_BOTTOM;
    // Layout changes while folded never turn historical reading back into follow-latest.
    if (direction > 0 || !this.options().hidden) {
      this.followLatest = near;
      this.update({ away: !near, ...(near ? { unseen: 0 } : {}) });
    } else { this.followLatest = false; this.update({ away: true }); }
    this.captureAnchor();
    if (this.accumulated >= READING_DIRECTION_THRESHOLD) {
      this.accumulated = 0;
      if (direction > 0 || near && !this.options().hidden) this.changeVisibility(false);
      else if (!this.options().locked) this.changeVisibility(true);
    } else if (near && direction > 0) this.changeVisibility(false);
    // Remove only compensation that no longer protects the current reading position.
    if (!this.followLatest && this.compensation) this.preserveAnchor();
  };
  private changeVisibility(hidden: boolean, focus = false) {
    if (hidden === this.options().hidden && !focus) return;
    this.captureAnchor();
    this.options().changeVisibility?.(hidden, focus, this.root);
  }

  showComposer = () => { this.changeVisibility(false, true); };
  visibilityChanged() { this.preserveAnchor(); }
  latest = (smooth = false) => {
    this.followLatest = true; this.intentUntil = 0; this.direction = 0; this.accumulated = 0;
    this.update({ away: false, unseen: 0 });
    this.changeVisibility(false);
    this.setCompensation(0);
    this.programmaticUntil = this.now() + 1000;
    if (smooth && this.root.scrollTo && !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)) {
      this.root.scrollTo({ top: this.root.scrollHeight, behavior: 'smooth' });
    } else this.writeBottom();
  };
  quote(node: HTMLElement) {
    this.followLatest = false; this.intentUntil = 0; this.programmaticUntil = this.now() + 1000;
    this.update({ away: true });
    node.scrollIntoView({ behavior: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
  }
  messagesChanged(count: number, lastId: string | undefined, _own: boolean) {
    const added = Math.max(0, count - this.seenCount);
    const appended = added > 0 && lastId !== this.lastId;
    this.seenCount = count; this.lastId = lastId; this.refreshObserved();
    // A send can finish after the author has already started reading older
    // messages. Its origin does not override that more recent reading intent.
    if (!count || this.followLatest) { this.latest(); }
    else {
      if (appended) this.update({ unseen: this.state.unseen + added });
      this.preserveAnchor();
    }
  }
  dispose() {
    this.disposed = true;
    this.root.removeEventListener('wheel', this.wheel); this.root.removeEventListener('scroll', this.scrolled);
    this.root.removeEventListener('touchstart', this.touchStart); this.root.removeEventListener('touchmove', this.touchMove);
    this.root.removeEventListener('touchend', this.touchEnd); this.root.removeEventListener('touchcancel', this.touchEnd);
    this.root.removeEventListener('keydown', this.keyDown); this.root.removeEventListener('pointerdown', this.pointerDown);
    window.removeEventListener('pointerup', this.pointerUp); window.removeEventListener('pointercancel', this.pointerUp);
    window.removeEventListener('resize', this.layoutChanged); this.observer?.disconnect();
    this.root.style.overflowAnchor = this.oldOverflowAnchor; this.spacer.style.height = '';
  }
}

export function useReadingScroll({ root, spacer, identity, hidden, locked, changeVisibility, count, lastId, own }: {
  root: RefObject<HTMLDivElement | null>; spacer: RefObject<HTMLDivElement | null>; identity: string;
  hidden: boolean; locked: boolean; changeVisibility?: ReadingOptions['changeVisibility']; count: number; lastId?: string; own: boolean;
}) {
  const options = useRef({ hidden, locked, changeVisibility }); options.current = { hidden, locked, changeVisibility };
  const controller = useRef<ReadingScrollController | undefined>(undefined);
  const [state, setState] = useState<ViewState>({ away: false, unseen: 0 });
  useLayoutEffect(() => {
    if (!root.current || !spacer.current) return;
    const value = new ReadingScrollController(root.current, spacer.current, () => options.current, setState, count, lastId);
    controller.current = value; setState({ away: false, unseen: 0 });
    return () => { value.dispose(); if (controller.current === value) controller.current = undefined; };
  }, [root, spacer, identity]);
  useLayoutEffect(() => { controller.current?.messagesChanged(count, lastId, own); }, [count, lastId, own]);
  useLayoutEffect(() => { controller.current?.visibilityChanged(); }, [hidden]);
  const latest = useCallback((smooth = false) => controller.current?.latest(smooth), []);
  const quote = useCallback((node: HTMLElement) => controller.current?.quote(node), []);
  const showComposer = useCallback(() => controller.current?.showComposer(), []);
  return { ...state, latest, quote, showComposer };
}
