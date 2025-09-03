export type ObjectType = 'horse' | 'employee' | 'customer' | 'product';

export interface MBObject {
  id: string;
  tenantId: string;
  type: ObjectType;
  name: string;
  integrations?: Record<string, { enabled: boolean; [k: string]: any }>;
  metadata?: Record<string, any>;
  tags?: { qr?: string; rfidEpc?: string; nfcUid?: string };
  createdAt: string;
  updatedAt: string;
}