import { FindMeServer } from "./app/features/server/server.mjs";
import { createServer } from "http";

const httpServer = createServer();

try {
    new FindMeServer({ server: httpServer });
} catch (error) {
    console.error("Error starting server:", error);
    process.exit(1);
}

httpServer.listen(8080, () => {
    console.log(`Test server runs on ${httpServer.address().address}:${httpServer.address().port}`);
});