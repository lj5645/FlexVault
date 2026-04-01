import { dispatchAppNotify } from '@/lib/app-notify';
import { t } from '@/lib/i18n';

interface CopyTextOptions {
  successMessage?: string;
  errorMessage?: string;
  emptyMessage?: string;
  notify?: boolean;
  onSuccess?: () => void;
  onError?: () => void;
}

export async function copyTextToClipboard(value: string, options: CopyTextOptions = {}): Promise<boolean> {
  const text = String(value || '');
  if (!text.trim()) {
    if (options.notify !== false) {
      dispatchAppNotify('warning', options.emptyMessage || t('txt_nothing_to_copy'));
    }
    return false;
  }

  try {
    await navigator.clipboard.writeText(text);
    options.onSuccess?.();
    if (options.notify !== false) {
      dispatchAppNotify('success', options.successMessage || t('txt_copied'));
    }
    return true;
  } catch {
    options.onError?.();
    if (options.notify !== false) {
      dispatchAppNotify('error', options.errorMessage || t('txt_copy_failed'));
    }
    return false;
  }
}
