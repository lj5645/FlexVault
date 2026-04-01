import { SQLiteD1Adapter, D1Database as NodeD1Database } from './database';
import { FileSystemR2Adapter, R2Bucket as NodeR2Bucket } from './storage';
import { NotificationsHubNamespace, DurableObjectNamespace as NodeDurableObjectNamespace } from './websocket';

declare global {
  interface D1Database extends NodeD1Database {}
  interface R2Bucket extends NodeR2Bucket {}
  interface DurableObjectNamespace extends NodeDurableObjectNamespace {}
}

export { SQLiteD1Adapter, FileSystemR2Adapter, NotificationsHubNamespace };
