# Scrapbook - Microservices Architecture

Scrapbook is a microservices-based application running on Node.js and Docker. 

## Services
- **Gateway Service** (Port 3090): Routes traffic and serves the frontend client.
- **Auth Service** (Port 3001): Handles user authentication, session, and profiles.
- **Memories Service** (Port 3002): Handles memories creation and retrieval.
- **Social Service** (Port 3003): Handles friends and network suggestions.
- **Sharing Service** (Port 3004): Handles shared memory capsules.
- **Data Structure (DS) Service** (Port 3005 internal): Internal service managing the custom Bucketed Hash Map for persistence and performance.

## Running with Docker (Production Ready)

The application is fully containerized using Docker and Docker Compose. 

### Prerequisites
- Docker
- Docker Compose

### Environment Variables
Environment variables are injected automatically via `docker-compose.yml`. Each service uses the following key variables:
- `PORT`: The internal port the microservice runs on.
- `UPLOAD_DIR`: Defines where file uploads are temporarily processed or stored before volumes map them.
- `*_SERVICE_URL`: Service discovery URLs to communicate internally over Docker DNS (e.g. `http://auth-service:3001`).

### Port Mappings
- **Host Port `3090`** maps to Gateway Service. This is the only exposed port.
- All other ports (`3001`, `3002`, `3003`, `3004`, `3005`) are kept securely internal within the Docker network.

### Volume Mappings
- **Data persistence**: JSON stores (`users.json`, `memories.json`, etc.) are persisted using local volumes (e.g. `./auth-service/data:/usr/src/app/data`).
- **Uploads**: Media uploads are persisted and shared via a root volume (`./uploads:/usr/src/app/uploads`).
- **Frontend**: The static frontend client is mounted into the Gateway (`./client:/usr/src/app/pages`).

### Docker Commands

#### Build the images
To build (or rebuild) the images after a code change:
```bash
docker-compose build
```

To build a specific service individually:
```bash
docker-compose build auth-service
```

#### Start the containers
To start the entire application in detached mode:
```bash
docker-compose up -d
```
The application will be available at `http://localhost:3090`.

#### Stop the containers
To stop the application gracefully:
```bash
docker-compose down
```

#### Restart containers
```bash
docker-compose restart
```

## Running Locally (Without Docker)
For local development without Docker, you can create a `.env` file in each microservice directory using the provided `.env.example` template and run `npm install && node <service>_server.js`.
