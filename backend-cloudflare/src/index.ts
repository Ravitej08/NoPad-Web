import { RoomDurableObject } from "./room-do";
import type { Env } from "./types";
import { handleFiles } from "./routes/files";
import { handleOptions, json } from "./utils/cors";

export { RoomDurableObject };

const VALID_ROOM_NAME = /^[a-zA-Z0-9]{1,20}$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return handleOptions();

    const url = new URL(request.url);
    const path = url.pathname;

    const roomMatch = path.match(/^\/api\/rooms\/([^/]+)(\/.*)?$/);
    if (!roomMatch) return json({ error: "Not found" }, 404);

    const roomName = roomMatch[1]!;
    const rest = roomMatch[2] ?? "";

    if (!VALID_ROOM_NAME.test(roomName)) {
      return json(
        { error: "Invalid room name. Use a-z, A-Z, 0-9 only, 1-20 characters." },
        400,
      );
    }

    // File operations are handled directly by the main Worker with R2
    if (rest === "/files" || rest === "/upload" || rest.startsWith("/files/")) {
      return handleFiles(request, env, roomName, rest);
    }

    // WebSocket upgrades and room/block operations go to the Durable Object
    const stub = env.ROOMS.get(env.ROOMS.idFromName(roomName));
    return stub.fetch(request);
  },
};
