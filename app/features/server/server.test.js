import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TestWebSocket } from "./serverTestUtils.mjs";

describe("WebSocket Server", () => {
    /**
     * @type {TestWebSocket}
     */
    let roomOpener;

    beforeEach(async () => {
        roomOpener = new TestWebSocket('ws://localhost:8080');
        await roomOpener.waitUntil('open');
    });

    afterEach(async () => {
        roomOpener.close();
    });

    it("should respond with a ping upon a pong", async () => {
        const data = await roomOpener.sendAndWaitForResponse({ type: 'pong' }, 'ping');
        expect(data).toEqual({ type: 'ping' });
    });

    it('should respond with a created message upon a create message', {
        timeout: 5000
    }, async () => {
        const data = await roomOpener.sendAndWaitForResponse({ type: 'create', lat: 0, lng: 0 }, 'created');
        expect(data).contains({ type: 'created' });
    });
});
