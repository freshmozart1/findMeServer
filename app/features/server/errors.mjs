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

export class LatitudeRequiredError extends Error {
    constructor() {
        super("Latitude is required");
        this.name = "LatitudeRequiredError";
    }
}

export class LongitudeRequiredError extends Error {
    constructor() {
        super("Longitude is required");
        this.name = "LongitudeRequiredError";
    }
}

export class LatitudeError extends Error {
    constructor() {
        super("Latitude is invalid");
        this.name = "LatitudeError";
    }
}


export class LongitudeError extends Error {
    constructor() {
        super("Longitude is invalid");
        this.name = "LongitudeError";
    }
}
