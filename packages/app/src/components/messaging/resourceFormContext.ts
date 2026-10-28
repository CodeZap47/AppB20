/** Presentation hooks shared by module pages and in-chat creation. */
export interface ResourceFormContext {
  initialTitle?: string;
  onSaved?: (id: string, shareable: boolean) => void;
  onCancel?: () => void;
  onBusyChange?: (busy: boolean) => void;
}
