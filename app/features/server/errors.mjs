function createErrorClass(name, message) {
    return class extends Error {
        constructor() {
            super(message);
            this.name = name;
        }
    };
}

export class DatabaseNotInitializedError extends Error {
    constructor() {
        super('Database not initialized');
        this.name = 'DatabaseNotInitializedError';
    }
}

export const UserNotInRoomError = createErrorClass('UserNotInRoomError', 'User is not in a room');

export const WebSocketUserIdError = createErrorClass('WebSocketUserIdError', 'WebSocket has no user id');

export const LatitudeRequiredError = createErrorClass('LatitudeRequiredError', 'Latitude is required');

export const LongitudeRequiredError = createErrorClass('LongitudeRequiredError', 'Longitude is required');

export const LatitudeError = createErrorClass('LatitudeError', 'Latitude is invalid');

export const LongitudeError = createErrorClass('LongitudeError', 'Longitude is invalid');

export const TimeError = createErrorClass('TimeError', 'Time is required');

export const WebSocketError = createErrorClass('WebSocketError', 'WebSocket is required');

export const RoomIdError = createErrorClass('RoomIdError', 'WebSocket has no room id');

export const UserIdError = createErrorClass('UserIdError', 'User id is required');

export const MessageError = createErrorClass('MessageError', 'A Message is required');

export const MessageTypeRequiredError = createErrorClass('MessageTypeRequiredError', 'Message type is required');

export const MessageTypeError = createErrorClass('MessageTypeError', 'Message type is invalid');

export const RoomError = createErrorClass('RoomError', 'Room does not exist');

export const RoomExistsError = createErrorClass('RoomExistsError', 'Room already exists');

export const LocationSnapshotsError = createErrorClass('LocationSnapshotsError', 'WebSocket has no location snapshots');

export const SubscribeToOwnLocationError = createErrorClass('SubscribeToOwnLocationError', 'Cannot subscribe to own location');

export const UnsubscribeFromOwnLocationError = createErrorClass('UnsubscribeFromOwnLocationError', 'Cannot unsubscribe from own location');

export const RoomSnapshotError = createErrorClass('RoomSnapshotError', 'WebSocket has no room snapshot');

export const UserInRoomError = createErrorClass('UserInRoomError', 'User is already in a room');
