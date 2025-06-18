import { FindMeServer } from "./app/features/server/server.mjs";
import { getConfig } from "./app/features/server/getConfig.mjs";
import { createServer } from "http";
import { getFirestore } from "firebase/firestore";
import { initializeApp } from "firebase/app";

const { apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId, databaseId } = getConfig();

const httpServer = createServer();

try {
    new FindMeServer(getFirestore(initializeApp({ apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId }), databaseId), { server: httpServer });
} catch (error) {
    console.error("Error starting server:", error);
    process.exit(1);
}

httpServer.listen(8080, () => {
    console.log(`Test server runs on ${httpServer.address().address}:${httpServer.address().port}`);
});