import { db } from '../config/database.js';
import { Request } from 'express';

export async function logAction(req: Request, action: string, details: string) {
    try {
        const adminId = (req.session as any)?.user?.id || null;
        const adminUsername = (req.session as any)?.user?.username || 'system';

        await db.collection('audit_logs').add({
            admin_id: adminId,
            username: adminUsername,
            action,
            details,
            timestamp: new Date().toISOString(),
            created_at: new Date().toISOString()
        });
    } catch (err) {
        console.error('[AUDIT FAIL]', err);
    }
}
