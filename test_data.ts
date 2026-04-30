import { db } from './config/database.js';
async function run() {
    try {
        const snap = await db.collection('bulletins').orderBy('created_at', 'desc').limit(2).get();
        console.dir(snap.docs.map(d => d.data()), { depth: null });
    } catch (e) {
        console.error("Error", e);
    }
    process.exit(0);
}
run();
