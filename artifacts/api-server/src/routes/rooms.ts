import { Router, type IRouter } from "express";
import { db, roomsTable, filesTable, blocksTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getOrCreateRoom, validateRoomName, countWords } from "../lib/roomHelper";

const router: IRouter = Router();

router.get("/rooms/:roomName", async (req, res): Promise<void> => {
  const rawName = Array.isArray(req.params.roomName) ? req.params.roomName[0] : req.params.roomName;
  if (!validateRoomName(rawName)) {
    res.status(400).json({ error: "Invalid room name. Use a-z, A-Z, 0-9 only, 1-20 characters." });
    return;
  }

  const room = await getOrCreateRoom(rawName);

  const files = await db.select().from(filesTable).where(eq(filesTable.roomId, room.id));
  const blocks = await db.select().from(blocksTable).where(eq(blocksTable.roomId, room.id));

  res.json({
    id: room.id,
    name: room.name,
    createdAt: room.createdAt,
    expiresAt: room.expiresAt,
    fileCount: files.length,
    wordCount: countWords(blocks),
  });
});

export default router;
