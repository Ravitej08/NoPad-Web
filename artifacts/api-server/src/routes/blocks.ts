import { Router, type IRouter } from "express";
import { db, blocksTable, roomsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { validateRoomName, countWords, MAX_WORD_COUNT } from "../lib/roomHelper";
import { getOrCreateRoom } from "../lib/roomHelper";

const router: IRouter = Router();

router.get("/rooms/:roomName/blocks", async (req, res): Promise<void> => {
  const rawName = Array.isArray(req.params.roomName) ? req.params.roomName[0] : req.params.roomName;
  if (!validateRoomName(rawName)) {
    res.status(400).json({ error: "Invalid room name" });
    return;
  }

  const rooms = await db.select().from(roomsTable).where(eq(roomsTable.name, rawName)).limit(1);
  if (rooms.length === 0) {
    res.json([]);
    return;
  }

  const room = rooms[0];
  const now = new Date();
  if (room.expiresAt < now) {
    res.json([]);
    return;
  }

  const blocks = await db.select().from(blocksTable)
    .where(eq(blocksTable.roomId, room.id))
    .orderBy(blocksTable.createdAt);

  res.json(blocks.map(b => ({
    id: b.id,
    roomId: b.roomId,
    content: b.content,
    ownerId: b.ownerId,
    committed: b.committed,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  })));
});

router.post("/rooms/:roomName/blocks", async (req, res): Promise<void> => {
  const rawName = Array.isArray(req.params.roomName) ? req.params.roomName[0] : req.params.roomName;
  if (!validateRoomName(rawName)) {
    res.status(400).json({ error: "Invalid room name" });
    return;
  }

  const { ownerId } = req.body;
  if (!ownerId || typeof ownerId !== "string") {
    res.status(400).json({ error: "ownerId is required" });
    return;
  }

  const { room } = await getOrCreateRoom(rawName);
  const now = new Date();
  if (room.expiresAt < now) {
    res.status(400).json({ error: "Room has expired" });
    return;
  }

  const existingBlocks = await db.select().from(blocksTable).where(eq(blocksTable.roomId, room.id));
  const wordCount = countWords(existingBlocks);
  if (wordCount >= MAX_WORD_COUNT) {
    res.status(400).json({ error: `Word limit of ${MAX_WORD_COUNT} reached. Delete some blocks first.` });
    return;
  }

  const blockId = uuidv4();
  const [block] = await db.insert(blocksTable).values({
    id: blockId,
    roomId: room.id,
    content: "",
    ownerId: null,
    committed: false,
    createdAt: now,
    updatedAt: now,
  }).returning();

  const response = {
    id: block.id,
    roomId: block.roomId,
    content: block.content,
    ownerId: block.ownerId,
    committed: block.committed,
    createdAt: block.createdAt,
    updatedAt: block.updatedAt,
  };

  const io = (req as any).app.get("io");
  if (io) {
    io.to(`room:${rawName}`).emit("block:created", response);
  }

  res.status(201).json(response);
});

router.put("/rooms/:roomName/blocks/:blockId", async (req, res): Promise<void> => {
  const rawName = Array.isArray(req.params.roomName) ? req.params.roomName[0] : req.params.roomName;
  const rawBlockId = Array.isArray(req.params.blockId) ? req.params.blockId[0] : req.params.blockId;

  const { content, ownerId } = req.body;
  if (content == null || typeof content !== "string") {
    res.status(400).json({ error: "content is required" });
    return;
  }

  const blocks = await db.select().from(blocksTable).where(eq(blocksTable.id, rawBlockId)).limit(1);
  if (blocks.length === 0) {
    res.status(404).json({ error: "Block not found" });
    return;
  }

  const block = blocks[0];

  if (block.committed && block.ownerId && block.ownerId !== ownerId) {
    res.status(403).json({ error: "Block is committed. Only the owner can edit it." });
    return;
  }

  const allBlocks = await db.select().from(blocksTable).where(eq(blocksTable.roomId, block.roomId));
  const otherBlocks = allBlocks.filter(b => b.id !== block.id);
  const totalWords = countWords([...otherBlocks, { content }]);
  if (totalWords > MAX_WORD_COUNT) {
    res.status(400).json({ error: `Word limit of ${MAX_WORD_COUNT} exceeded` });
    return;
  }

  const now = new Date();
  const [updated] = await db.update(blocksTable)
    .set({ content, updatedAt: now })
    .where(eq(blocksTable.id, rawBlockId))
    .returning();

  const response = {
    id: updated.id,
    roomId: updated.roomId,
    content: updated.content,
    ownerId: updated.ownerId,
    committed: updated.committed,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  };

  const io = (req as any).app.get("io");
  if (io) {
    io.to(`room:${rawName}`).emit("block:updated", response);
  }

  res.json(response);
});

router.delete("/rooms/:roomName/blocks/:blockId", async (req, res): Promise<void> => {
  const rawName = Array.isArray(req.params.roomName) ? req.params.roomName[0] : req.params.roomName;
  const rawBlockId = Array.isArray(req.params.blockId) ? req.params.blockId[0] : req.params.blockId;

  const ownerId = req.body?.ownerId;

  const blocks = await db.select().from(blocksTable).where(eq(blocksTable.id, rawBlockId)).limit(1);
  if (blocks.length === 0) {
    res.status(404).json({ error: "Block not found" });
    return;
  }

  const block = blocks[0];

  if (block.committed && block.ownerId && block.ownerId !== ownerId) {
    res.status(403).json({ error: "Block is committed. Only the owner can delete it." });
    return;
  }

  await db.delete(blocksTable).where(eq(blocksTable.id, rawBlockId));

  const io = (req as any).app.get("io");
  if (io) {
    io.to(`room:${rawName}`).emit("block:deleted", { id: rawBlockId });
  }

  res.json({ success: true });
});

router.post("/rooms/:roomName/blocks/:blockId/commit", async (req, res): Promise<void> => {
  const rawName = Array.isArray(req.params.roomName) ? req.params.roomName[0] : req.params.roomName;
  const rawBlockId = Array.isArray(req.params.blockId) ? req.params.blockId[0] : req.params.blockId;

  const { ownerId } = req.body;
  if (!ownerId || typeof ownerId !== "string") {
    res.status(400).json({ error: "ownerId is required" });
    return;
  }

  const blocks = await db.select().from(blocksTable).where(eq(blocksTable.id, rawBlockId)).limit(1);
  if (blocks.length === 0) {
    res.status(404).json({ error: "Block not found" });
    return;
  }

  const block = blocks[0];

  if (block.committed && block.ownerId && block.ownerId !== ownerId) {
    res.status(403).json({ error: "Block is already committed by another owner" });
    return;
  }

  const now = new Date();
  const [updated] = await db.update(blocksTable)
    .set({
      committed: !block.committed || block.ownerId !== ownerId ? true : false,
      ownerId: ownerId,
      updatedAt: now,
    })
    .where(eq(blocksTable.id, rawBlockId))
    .returning();

  const response = {
    id: updated.id,
    roomId: updated.roomId,
    content: updated.content,
    ownerId: updated.ownerId,
    committed: updated.committed,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  };

  const io = (req as any).app.get("io");
  if (io) {
    io.to(`room:${rawName}`).emit("block:updated", response);
  }

  res.json(response);
});

export default router;
