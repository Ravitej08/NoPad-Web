# Workspace

## Overview

pnpm workspace monorepo using TypeScript. nopad — a real-time, room-based ephemeral collaboration platform.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5 + Socket.io
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite (artifacts/nopad)
- **Real-time**: Socket.io (server at /ws/socket.io path)

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   ├── api-server/         # Express API server + Socket.io
│   └── nopad/              # React + Vite frontend
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## nopad Features

- URL-based rooms: /{roomName} — auto-created on first visit
- Room TTL: 20 minutes, no reset on activity
- Auto cleanup: background worker runs every 60 seconds
- No login required, fully ephemeral
- File sharing: up to 5 files, 25MB each
- Text blocks: real-time collaborative editing with commit/ownership
- Real-time sync via Socket.io
- Three themes: White, Black (dark), Hacker (green terminal)

## Database Schema

- **rooms**: id, name, created_at, expires_at
- **files**: id, room_id, original_name, stored_name, size, mime_type, uploaded_at
- **blocks**: id, room_id, content, owner_id, committed, created_at, updated_at

## API Routes

- GET /api/rooms/:roomName — get or create room
- GET /api/rooms/:roomName/files — list files
- POST /api/rooms/:roomName/upload — upload file (multipart)
- GET /api/rooms/:roomName/files/:fileId — download file
- DELETE /api/rooms/:roomName/files/:fileId — delete file
- GET /api/rooms/:roomName/blocks — list blocks
- POST /api/rooms/:roomName/blocks — create block
- PUT /api/rooms/:roomName/blocks/:blockId — update block
- DELETE /api/rooms/:roomName/blocks/:blockId — delete block
- POST /api/rooms/:roomName/blocks/:blockId/commit — commit/uncommit block

## Socket.io Events

- Server path: /ws/socket.io
- Client emits: join:room
- Server emits: file:uploaded, file:deleted, block:created, block:updated, block:deleted

## Files stored

- /tmp/nopad/{roomId}/ — temp file storage (deleted on room expiry)
