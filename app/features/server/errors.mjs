export class DatabaseNotInitializedError extends Error {
    constructor() {
        super("Database not initialized");
        this.name = "DatabaseNotInitializedError";
    }
}

export class UserNotInRoomError extends Error {
    constructor() {
        super("User is not in a room");
        this.name = "UserNotInRoomError";
    }
}

export class NoUserIdError extends Error {
    constructor() {
        super("WebSocket has no user id");
        this.name = "NoUserIdError";
    }
}