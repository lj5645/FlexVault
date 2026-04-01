export type AppNotifyType = 'success' | 'error' | 'warning';

export interface AppNotifyDetail {
  type: AppNotifyType;
  text: string;
}

export const APP_NOTIFY_EVENT = 'nodewarden:notify';

export function dispatchAppNotify(type: AppNotifyType, text: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<AppNotifyDetail>(APP_NOTIFY_EVENT, { detail: { type, text } }));
}
