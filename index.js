import { startServer } from "./app/features/server/server.mjs";
import { getConfig } from "./app/features/server/getConfig.mjs";

const { apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId, databaseId } = getConfig();

startServer({
    firebaseConfig: { apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId },
    databaseId
});