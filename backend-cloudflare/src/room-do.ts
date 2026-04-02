import type { Block, Room } from "./types";
import { json } from "./utils/cors";

const ROOM_TTL_MS = 20 * 60 * 1000;

export class RoomDurableObject {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Native WebSocket upgrade
    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocket();
    }

    // Internal broadcast from main Worker (file events)
    if (path === "/_internal/broadcast" && method === "POST") {
      const { event, data } = await request.json<{ event: string; data: unknown }>();
      this.broadcast(event, data);
      return new Response("OK");
    }

    // Parse room name from path
    const match = path.match(/^\/api\/rooms\/([^/]+)(\/.*)?$/);
    const roomName = match?.[1] ?? "";
    const rest = match?.[2] ?? "";

    if (rest === "" && method === "GET") return this.getOrCreateRoom(roomName);
    if (rest === "/blocks" && method === "GET") return this.listBlocks();
    if (rest === "/blocks" && method === "POST") {
      const body = await request.json<{ ownerId: string }>();
      return this.createBlock(body.ownerId);
    }

    const updateMatch = rest.match(/^\/blocks\/([^/]+)$/);
    if (updateMatch && method === "PUT") {
      const body = await request.json<{ content: string; ownerId: string }>();
      return this.updateBlock(updateMatch[1]!, body);
    }
    if (updateMatch && method === "DELETE") {
      const body = await request.json<{ ownerId: string }>();
      return this.deleteBlock(updateMatch[1]!, body.ownerId);
    }

    const commitMatch = rest.match(/^\/blocks\/([^/]+)\/commit$/);
    if (commitMatch && method === "POST") {
      const body = await request.json<{ ownerId: string }>();
      return this.toggleCommit(commitMatch[1]!, body.ownerId);
    }

    return new Response("Not Found", { status: 404 });
  }

  // ─── WebSocket ───────────────────────────────────────────────────────────────

  private handleWebSocket(): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.state.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer): Promise<void> {
    // Reserved for future client → server messages
  }

  async webSocketClose(_ws: WebSocket): Promise<void> {
    // Hibernation handles cleanup automatically
  }

  async webSocketError(_ws: WebSocket, _error: unknown): Promise<void> {
    // Handled by runtime
  }

  private broadcast(event: string, data: unknown): void {
    const msg = JSON.stringify({ event, data });
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(msg);
      } catch {
        // Connection already closed
      }
    }
  }

  // ─── Room ────────────────────────────────────────────────────────────────────

  private async getOrCreateRoom(name: string): Promise<Response> {
    let room = await this.state.storage.get<Room>("room");

    if (room) {
      if (new Date(room.expiresAt) <= new Date()) {
        await this.cleanupRoom();
        return json({ error: "Room expired" }, 410);
      }
    } else {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + ROOM_TTL_MS);
      room = {
        id: crypto.randomUUID(),
        name,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
      };
      await this.state.storage.put("room", room);
      await this.state.storage.setAlarm(expiresAt.getTime());
      await this.createDefaultBlock(room.id);
    }

    const blocks = await this.getBlocks();
    const wordCount = blocks.reduce(
      (acc, b) => acc + b.content.split(/\s+/).filter(Boolean).length,
      0,
    );

    return json({
      id: room.id,
      name: room.name,
      createdAt: room.createdAt,
      expiresAt: room.expiresAt,
      fileCount: 0,
      wordCount,
    });
  }

  // ─── Blocks ──────────────────────────────────────────────────────────────────

  private async getBlocks(): Promise<Block[]> {
    const ids = (await this.state.storage.get<string[]>("blockIds")) ?? [];
    const results = await Promise.all(
      ids.map((id) => this.state.storage.get<Block>(`block:${id}`)),
    );
    return (results.filter(Boolean) as Block[]).sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }

  private async listBlocks(): Promise<Response> {
    return json(await this.getBlocks());
  }

  private async createDefaultBlock(roomId: string): Promise<void> {
    const now = new Date().toISOString();
    const block: Block = {
      id: crypto.randomUUID(),
      roomId,
      content: "",
      ownerId: null,
      committed: false,
      createdAt: now,
      updatedAt: now,
    };
    await this.state.storage.put("blockIds", [block.id]);
    await this.state.storage.put(`block:${block.id}`, block);
  }

  private async createBlock(ownerId: string): Promise<Response> {
    const room = await this.state.storage.get<Room>("room");
    if (!room) return json({ error: "Room not found" }, 404);

    const now = new Date().toISOString();
    const block: Block = {
      id: crypto.randomUUID(),
      roomId: room.id,
      content: "",
      ownerId,
      committed: false,
      createdAt: now,
      updatedAt: now,
    };

    const ids = (await this.state.storage.get<string[]>("blockIds")) ?? [];
    ids.push(block.id);
    await this.state.storage.put("blockIds", ids);
    await this.state.storage.put(`block:${block.id}`, block);
    this.broadcast("block:created", block);
    return json(block, 201);
  }

  private async updateBlock(
    blockId: string,
    data: { content: string; ownerId: string },
  ): Promise<Response> {
    const block = await this.state.storage.get<Block>(`block:${blockId}`);
    if (!block) return json({ error: "Block not found" }, 404);
    if (block.committed && block.ownerId !== data.ownerId) {
      return json({ error: "Block is locked" }, 403);
    }

    const updated: Block = {
      ...block,
      content: data.content,
      ownerId: block.ownerId ?? data.ownerId,
      updatedAt: new Date().toISOString(),
    };
    await this.state.storage.put(`block:${blockId}`, updated);
    this.broadcast("block:updated", updated);
    return json(updated);
  }

  private async deleteBlock(blockId: string, ownerId: string): Promise<Response> {
    const block = await this.state.storage.get<Block>(`block:${blockId}`);
    if (!block) return json({ error: "Block not found" }, 404);
    if (block.committed && block.ownerId !== ownerId) {
      return json({ error: "Block is locked" }, 403);
    }

    const ids = (await this.state.storage.get<string[]>("blockIds")) ?? [];
    await this.state.storage.put("blockIds", ids.filter((id) => id !== blockId));
    await this.state.storage.delete(`block:${blockId}`);
    this.broadcast("block:deleted", { id: blockId });
    return json({ success: true });
  }

  private async toggleCommit(blockId: string, ownerId: string): Promise<Response> {
    const block = await this.state.storage.get<Block>(`block:${blockId}`);
    if (!block) return json({ error: "Block not found" }, 404);
    if (block.committed && block.ownerId !== ownerId) {
      return json({ error: "Only the owner can uncommit" }, 403);
    }

    const updated: Block = {
      ...block,
      committed: !block.committed,
      ownerId: block.ownerId ?? ownerId,
      updatedAt: new Date().toISOString(),
    };
    await this.state.storage.put(`block:${blockId}`, updated);
    this.broadcast("block:updated", updated);
    return json(updated);
  }

  // ─── Cleanup (alarm) ─────────────────────────────────────────────────────────

  private async cleanupRoom(): Promise<void> {
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.close(1001, "Room expired");
      } catch {
        // Already closed
      }
    }
    await this.state.storage.deleteAll();
  }

  async alarm(): Promise<void> {
    await this.cleanupRoom();
  }
}
