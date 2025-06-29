function createErrorClass(name, message) {
    return class extends Error {
        constructor() {
            super(message);
            super.name = name;
        }
    };
}

export const LatitudeRequiredError = createErrorClass('LatitudeRequiredError', 'Latitude is required');

export const LongitudeRequiredError = createErrorClass('LongitudeRequiredError', 'Longitude is required');

export const LatitudeError = createErrorClass('LatitudeError', 'Latitude is invalid');

export const LongitudeError = createErrorClass('LongitudeError', 'Longitude is invalid');

export const WebSocketError = createErrorClass('WebSocketError', 'WebSocket is required');

export const UserInRoomError = createErrorClass('UserInRoomError', 'User is already in a room');

export const RoomIdRequiredError = createErrorClass('RoomIdRequiredError', 'Room ID is required');