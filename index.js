import { startServer } from "./app/features/server/server.mjs";
import { getConfig } from "./app/features/server/getConfig.mjs";
import { createServer } from "http";

const { apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId, databaseId } = getConfig();

const httpServer = createServer();

await startServer({
    httpServer,
    firebaseConfig: { apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId },
    databaseId
});

httpServer.listen(8080, () => {
    console.log(`Test server runs on ${httpServer.address().address}:${httpServer.address().port}`);
});