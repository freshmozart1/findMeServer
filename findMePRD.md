# Table of contents
- [Introduction](#introduction)
- [Purpose](#purpose)
- [Vision](#vision)
- [Goals and Objectives](#goals-and-objectives)
- [Scope and Requirements](#scope-and-requirements)
    - [Functional Requirements](#functional-requirements)
- Technical Architecture
    - Frontend
    - Backend
    - CI/CD pipelines

# Introduction
## Purpose
Two friends want to meet quickly at an agreed-upon meeting point but are currently traveling separately without knowing each other's exact positions or estimated arrival times. Communicating frequently via calls or text messages is inconvenient and potentially disruptive, especially in situations where phone use is limited or unsafe. This creates uncertainty and inefficiency in coordinating their meeting.

## Vision
The web application addresses this problem by providing a real-time interactive map displaying each friend's current location, the meeting point, and their respective routes. It also dynamically calculates and clearly shows each friend's estimated time of arrival (ETA) at the destination. The app's key value is eliminating the uncertainty of meeting coordination by offering effortless, continuous visibility of both friends' locations and ETA. Its primary target audience will include teenagers and young adults.

## Goals and Objectives
The primary goal of the project is to deliver an intuitive, user-friendly, and reliable web application that fulfils the users' need for information about another users current location and ETA at a agreed-upon meeting point. Objectives include:

- Providing real-time updates of users' locations and routes.
- Accurately estimating arrival times to facilitate effective planning.

# Scope and Requirements
## Functional Requirements
| ID    | Feature                     | Frontend/Backend | Description                                                                                             | Acceptance Criteria                                                                                                                                                               | Priority |
|-------|-----------------------------|------------------|---------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------|
| FR-01 | Real-time Location Tracking | Frontend | The application must continuously track and display each user's geographic location on an interactive map, updating automatically at least every 10 seconds. | - User locations must be accurate.<br>- Locations must update without manual refresh.<br>- Each user's position must be visually distinct (e.g., different colors or markers).     | High     |
| FR-02 | ETA Calculation             | Frontend | The application must accurately calculate and display each user's Estimated Time of Arrival (ETA) at the agreed-upon meeting point, automatically refreshing at least every 10 seconds. | - ETA must be clearly visible near each user's location marker.<br>- Updates must happen automatically without manual refresh.<br>- ETA must consider traffic and route changes.   | High     |
| FR-03 | Route Calculation           | Frontend | The application must calculate and display optimal routes from each user's current location to the meeting point, updating dynamically.                | - Routes must be clearly visible as continuous lines.<br>- Route colors must match user markers.<br>- Routes dynamically update based on changing locations.                       | High     |
| FR-04 | User ID Generation          | Frontend/Backend | When users access the application, it must generate and display a unique, randomly generated 4-digit numerical user ID identifying them among active users. | - User IDs must always be unique.<br>- IDs regenerate with each new session.                                                                                                      | High     |
| FR-05 | User ID Input               | Frontend         | The application must provide an input field allowing entry of another user's 4-digit User ID, accompanied by a submit button enabled only upon valid entry. | - Submit button remains disabled until exactly four digits match an active user.<br>- Visual feedback indicates valid or invalid entries.                                         | High     |
| FR-06 | Map Size                    | Frontend         | The application must display an interactive map occupying the full available screen area without obscuring other UI components.                      | - Map adjusts responsively to screen sizes.<br>- All UI components must remain clearly visible above the map.                                                                      | High     |
| FR-07 | Share User ID               | Frontend         | The application must include a share button enabling users to easily distribute their User ID via common apps (WhatsApp, email, SMS) with a pre-populated message. Users must select a meeting point before they can share their user ID. The proposed meeting point must also be included in the pre-filled user ID message. | - Clicking share opens an overlay with selectable sharing options.<br>- Selecting a method opens the corresponding app with a pre-filled message containing the User ID and the selected meeting point.<br>- Share button is disabled until a meeting point is selected. | High     |
| FR-08 | Accept Connection Request   | Frontend         | The application must display an overlay notification prompting users to accept or decline incoming connection requests initiated by sharing User IDs.   | - Overlay clearly provides accept and decline options.<br>- Acceptance enables mutual visibility of locations and ETAs.<br>- Declines provide immediate feedback to request initiator. | High     |
| FR-09 | Meeting Point Selection      | Frontend/Backend | The application must allow users to propose setting or changing the agreed-upon meeting point on the map. All other users must accept the request before the meeting point is changed. | - Users can propose a new meeting point on the map.<br>- All connected users receive a request to accept or decline the change.<br>- The meeting point is only updated if all users accept.<br>- The meeting point is clearly marked and visible to all connected users.<br>- Changing the meeting point updates routes and ETAs for all users in real time. | High     |
| FR-10 | Privacy Controls             | Frontend         | The application must provide users with the ability to pause or stop sharing their location at any time.                                          | - Users can toggle location sharing on or off.<br>- When paused, the user's last known location is indicated, and others are notified.                                                | High     |
| FR-11 | Session Management           | Frontend/Backend | The application must automatically end sessions after 5 minutes of inactivity or upon reaching the meeting point.                                  | - Users are notified when a session ends.<br>- All location and route data are cleared at session end.                                                                                | Medium   |
| FR-12 | Share Message Format         | Frontend         | The application must ensure that the pre-filled share message includes the user's 4-digit User ID, the selected meeting point (address or coordinates), a clear invitation to join the session, and a link to the web application. The link must contain the 4-digit user ID as a URL parameter. When the invited user clicks the link, the web app must open with the user ID input field (FR-05) pre-filled with the sender's 4-digit user ID, and the proposed meeting point (FR-07) displayed on the map (FR-06). | - The message must contain the User ID, meeting point, and web app link in a readable format.<br>- The link must include the 4-digit user ID as a URL parameter.<br>- When the link is opened, the user ID input field is pre-filled and the meeting point is shown on the map.<br>- The message must include a call to action (e.g., "Join me at this location!").<br>- The message must be compatible with sharing via WhatsApp, email, and SMS. | High     |
| FR-13 | Pending Connection Notification | Frontend         | When a user clicks the submit button of the user ID input field (FR-05), the web application must display an overlay notification while the user that shared the user ID (FR-07) has not yet accepted the connection request (FR-08). The notification must inform the second user to wait for the connection request to be accepted. | - An overlay notification appears immediately after submitting the user ID.<br>- The notification clearly instructs the user to wait for acceptance.<br>- The overlay remains visible until the connection request is accepted or declined.<br>- If declined, the user receives immediate feedback. | High     |
| FR-14 | Room Deletion        | Backend          | The backend server must delete a room whenever a user disconnects or both users have reached the agreed-upon meeting point. | - The room is deleted immediately when a user disconnects.<br>- The room is deleted when both users have arrived at the meeting point.<br>- All references to user clients in the room are removed.<br>- No further location or ETA data is shared after room deletion. | High     |
| FR-15 | Room-based Data Exchange | Backend          | The backend server must ensure that only users who share the same room can exchange location and ETA data with each other. | - Location and ETA data are only transmitted between users in the same room.<br>- Users not in the same room cannot access each other's location or ETA data.<br>- Data isolation is enforced at the backend level. | High     |
| FR-16 | Active Room Persistence | Backend          | The backend server must maintain a consistent list of all active rooms in a database. | - All active rooms are stored in a persistent database.<br>- The list is updated in real time as rooms are created or deleted.<br>- The database accurately reflects the current state of active rooms at all times.<br>- Room data is removed from the database when a room is deleted. | High     |
| FR-17 | Room Creation         | Backend          | When a user accepts another user's connection request (FR-08), the backend server must create a room for both users to share. | - A room is created upon acceptance of a connection request.<br>- The room is created only if it does not already exist. | High     |
| FR-18 | Room Uniqueness      | Backend          | A room is a set containing only unique users. | - The room contains only unique users.<br>- Duplicate users are not allowed in the same room. | High     |
| FR-19 | Room Identification   | Backend          | The room ID must be the user ID of the user who shared their user ID (FR-07). | - The room ID is set to the user ID of the user who shared their user ID.<br>- The room can be referenced by this ID. | High     |
| FR-20 | Room Client References| Backend          | The room must maintain references to the user clients. | - The backend maintains up-to-date references to the user clients in the room.<br>- References are updated as users join or leave the room. | High     |
| FR-21 | Location Message Content       | Backend          | Location messages exchanged between user clients in a room must contain the room ID (FR-19), ETA, and GPS location data. | - Every message sent between user clients in a room includes the room ID, ETA, and GPS location data.<br>- Messages without these fields are rejected by the backend.<br>- The backend validates the presence and format of these fields in all exchanged messages. | High     |

# Technical Architecture
## Frontend
The frontend of the application is built as a Node.js package using React and Next.js to enable a modern, component-based, and server-side rendered web experience. The Google Maps API is integrated to provide real-time, interactive mapping features, including displaying user locations, routes, and meeting points. Key aspects include:

- **Node.js Package:** The frontend is structured and distributed as a Node.js package, allowing for easy installation, development, and deployment.
- **Framework:** React with Next.js for server-side rendering, routing, and optimized performance.
- **Mapping:** Google Maps JavaScript API for map rendering, markers, polylines, and geolocation features.
- **State Management:** React Context or a state management library (e.g., Redux or Zustand) to manage user sessions, locations, and UI state.
- **UI Components:** Modular React components for map, user ID input, sharing, notifications, and overlays.
- **API Communication:** REST or WebSocket connections to the backend for real-time location and session updates.
- **Responsiveness:** Fully responsive design to support mobile and desktop browsers.
- **Authentication:** (Optional) Integration with authentication providers if user accounts are required.

## Backend
The backend of the application is designed to run inside a Docker container and is deployed on Google Cloud Run, making it accessible via the web. The backend is responsible for managing real-time communication, room management, and data persistence. Key aspects include:

- **Containerization:** The backend runs in a Docker container for portability, scalability, and ease of deployment.
- **Cloud Hosting:** The Docker container is deployed on Google Cloud Run, providing a managed, scalable, and web-accessible backend service.
- **Real-time Communication:** WebRTC is used for peer-to-peer communication between user clients inside a room, enabling low-latency exchange of location and ETA data.
- **Room Management:** The backend manages rooms, where each room consists of a set of unique WebRTC clients (users) who can exchange data.
- **Database:** Google Firestore is used for persistent storage of room and client data. The Firestore collection is named 'rooms', and the data structure is:
  - `{ roomId1: [client, client], roomId2: [client, client], ... }`
  - Each document in the 'rooms' collection represents a room, with the room ID as the document key and an array of WebRTC client objects as the value.
- **Scalability:** The backend architecture supports dynamic scaling based on demand, leveraging Google Cloud Run's serverless capabilities.
- **Security:** Access to Firestore and WebRTC signaling is secured using appropriate authentication and authorization mechanisms.