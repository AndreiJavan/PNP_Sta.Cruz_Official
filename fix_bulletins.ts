import { db } from './config/database.js';

async function run() {
    console.log("Starting bulletin cleanup...");
    try {
        const snap = await db.collection('bulletins').get();
        console.log(`Found ${snap.docs.length} bulletins.`);

        let fixCount = 0;
        for (const doc of snap.docs) {
            const data = doc.data();
            if (data.is_archived === null || data.is_archived === undefined) {
                console.log(`Fixing bulletin: ${data.title} (ID: ${doc.id})`);
                await db.collection('bulletins').doc(doc.id).update({ is_archived: false });
                fixCount++;
            }
        }
        console.log(`Cleanup complete. Fixed ${fixCount} bulletins.`);
    } catch (err) {
        console.error("Cleanup failed:", err);
    }
    process.exit(0);
}

run();
