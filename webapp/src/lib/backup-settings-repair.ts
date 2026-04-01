import { createAuthedFetch } from './api/auth';
import { getAdminBackupSettingsRepairState, repairAdminBackupSettings } from './api/backup';
import { decryptPortableBackupSettings } from './admin-backup-portable';
import type { Profile, SessionState } from './types';

export async function silentlyRepairBackupSettingsIfNeeded(
  activeSession: SessionState,
  activeProfile: Profile
): Promise<void> {
  if (activeProfile.role !== 'admin') return;
  if (!activeSession.accessToken || !activeSession.symEncKey || !activeSession.symMacKey) return;

  const tempFetch = createAuthedFetch(() => activeSession, () => {});
  try {
    const state = await getAdminBackupSettingsRepairState(tempFetch);
    if (!state.needsRepair || !state.portable) return;
    const repairedSettings = await decryptPortableBackupSettings(state.portable, activeProfile, activeSession);
    await repairAdminBackupSettings(tempFetch, repairedSettings);
  } catch (error) {
    console.error('Backup settings auto-repair failed:', error);
  }
}
