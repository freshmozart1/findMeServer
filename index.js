import { FindMeServer } from "./app/features/server/server.mjs";
import { createServer } from "http";
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';

initializeApp({
    credential: applicationDefault()
});

const httpServer = createServer();

try {
    new FindMeServer(getAdminFirestore(undefined, 'findme-db'), { server: httpServer });
} catch (error) {
    console.error("Error starting server:", error);
    process.exit(1);
}

httpServer.listen(8080, () => {
    console.log(`Test server runs on ${httpServer.address().address}:${httpServer.address().port}`);
});