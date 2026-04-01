import { useState } from 'preact/hooks';
import type { ToastMessage } from '@/lib/types';

export function useToastManager() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  function removeToast(id: string) {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }

  function pushToast(type: ToastMessage['type'], text: string) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((prev) => [...prev.slice(-3), { id, type, text }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 4500);
  }

  return {
    toasts,
    pushToast,
    removeToast,
  };
}
