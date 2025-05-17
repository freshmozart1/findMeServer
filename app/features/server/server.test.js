import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { startTestServer, TestWebSocket } from "./serverTestUtils.mjs";
import { Http2Server } from "node:http2";

describe("WebSocket Server", () => {
    /**
     * @type {Http2Server}
     */
    let server;
    beforeAll(async () => {
        server = await startTestServer();
    });

    afterAll(() => {
        server.close();
    });

    it("should respond with a ping upon a pong", async () => {
        const client = new TestWebSocket('https://localhost:8080');
        await client.waitUntil('open');
        const responseMessage = await new Promise(resolve => {
            client.addEventListener('message', (event) => {
                const data = JSON.parse(event.data);
                if (data.type === 'ping') {
                    resolve(data);
                }
            });
            client.send(JSON.stringify({ type: 'pong' }));
        });
        expect(responseMessage).toEqual({
            type: 'ping'
        });
    });
});
