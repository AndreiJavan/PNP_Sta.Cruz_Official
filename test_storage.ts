import fs from 'fs';
import path from 'path';

async function testStorage() {
    const bucket = 'bulletins';
    const fileName = 'test.png';
    const buffer = Buffer.from('test data');

    try {
        const uploadDir = path.join(process.cwd(), 'public', bucket);
        console.log(`Target Dir: ${uploadDir}`);

        if (!fs.existsSync(uploadDir)) {
            console.log("Directory does not exist, creating...");
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        const filePath = path.join(uploadDir, fileName);
        console.log(`Writing to: ${filePath}`);
        fs.writeFileSync(filePath, buffer);
        console.log("Write successful!");

        // Cleanup
        fs.unlinkSync(filePath);
        console.log("Cleanup successful!");
    } catch (err: any) {
        console.error("STORAGE TEST FAILED:", err.message);
        console.error(err.stack);
    }
    process.exit(0);
}

testStorage();
