import * as admin from 'firebase-admin';

// Initialize Firebase Admin (assuming default env vars or simple init for local emulator)
// The user's code uses config/database.ts, let's just run their db config
import { db } from './config/database.js';

async function generateReport() {
    try {
        const snap = await db.collection('map_points').get();
        const points = snap.docs.map(doc => doc.data());
        console.log(JSON.stringify(points, null, 2));
    } catch (err) {
        console.error("Error:", err);
    }
}

generateReport();
