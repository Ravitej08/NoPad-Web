import { Router, type IRouter } from "express";
import { db, filesTable, roomsTable, blocksTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import fs from "fs";
import {
  getOrCreateRoom,
  validateRoomName,
  validateFileExtension,
  validateFileMime,
  getRoomDir,
  MAX_FILES_PER_ROOM,
  MAX_FILE_SIZE_MB,
} from "../lib/roomHelper";

const router: IRouter = Router();

const storage = multer.diskStorage({
  destination: async (req, _file, cb) => {
    try {
      const rawName = Array.isArray(req.params.roomName) ? req.params.roomName[0] : req.params.roomName;
      if (!validateRoomName(rawName)) {
        cb(new Error("Invalid room name"), "");
        return;
      }
      const room = await getOrCreateRoom(rawName);
      const dir = getRoomDir(room.id);
      fs.mkdirSync(dir, { recursive: true });
      (req as any).room = room;
      cb(null, dir);
    } catch (err) {
      cb(err as Error, "");
    }
  },
  filename: (_req, _file, cb) => {
    cb(null, uuidv4());
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE_MB * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (!validateFileExtension(file.originalname)) {
      cb(new Error("File type not allowed"));
      return;
    }
    cb(null, true);
  },
});

router.get("/rooms/:roomName/files", async (req, res): Promise<void> => {
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

  const files = await db.select().from(filesTable).where(eq(filesTable.roomId, room.id));
  res.json(files.map(f => ({
    id: f.id,
    roomId: f.roomId,
    originalName: f.originalName,
    storedName: f.storedName,
    size: f.size,
    mimeType: f.mimeType,
    uploadedAt: f.uploadedAt,
  })));
});

router.post("/rooms/:roomName/upload", upload.single("file"), async (req, res): Promise<void> => {
  const rawName = Array.isArray(req.params.roomName) ? req.params.roomName[0] : req.params.roomName;

  if (!validateRoomName(rawName)) {
    res.status(400).json({ error: "Invalid room name" });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: "No file provided" });
    return;
  }

  const room = (req as any).room;
  if (!room) {
    res.status(500).json({ error: "Room context missing" });
    return;
  }

  if (!validateFileMime(req.file.originalname, req.file.mimetype)) {
    fs.unlinkSync(req.file.path);
    res.status(400).json({ error: "File MIME type does not match extension" });
    return;
  }

  const existingFiles = await db.select().from(filesTable).where(eq(filesTable.roomId, room.id));

  if (existingFiles.length >= MAX_FILES_PER_ROOM) {
    fs.unlinkSync(req.file.path);
    res.status(400).json({ error: `Maximum ${MAX_FILES_PER_ROOM} files per room` });
    return;
  }

  const duplicate = existingFiles.find(f => f.originalName === req.file!.originalname);
  if (duplicate) {
    fs.unlinkSync(req.file.path);
    res.status(400).json({ error: "Duplicate file name" });
    return;
  }

  const fileId = uuidv4();
  const [fileRecord] = await db.insert(filesTable).values({
    id: fileId,
    roomId: room.id,
    originalName: req.file.originalname,
    storedName: req.file.filename,
    size: req.file.size,
    mimeType: req.file.mimetype,
    uploadedAt: new Date(),
  }).returning();

  const io = (req as any).app.get("io");
  if (io) {
    io.to(`room:${rawName}`).emit("file:uploaded", {
      id: fileRecord.id,
      roomId: fileRecord.roomId,
      originalName: fileRecord.originalName,
      storedName: fileRecord.storedName,
      size: fileRecord.size,
      mimeType: fileRecord.mimeType,
      uploadedAt: fileRecord.uploadedAt,
    });
  }

  res.status(201).json({
    id: fileRecord.id,
    roomId: fileRecord.roomId,
    originalName: fileRecord.originalName,
    storedName: fileRecord.storedName,
    size: fileRecord.size,
    mimeType: fileRecord.mimeType,
    uploadedAt: fileRecord.uploadedAt,
  });
});

router.get("/rooms/:roomName/files/:fileId", async (req, res): Promise<void> => {
  const rawName = Array.isArray(req.params.roomName) ? req.params.roomName[0] : req.params.roomName;
  const rawFileId = Array.isArray(req.params.fileId) ? req.params.fileId[0] : req.params.fileId;

  const rooms = await db.select().from(roomsTable).where(eq(roomsTable.name, rawName)).limit(1);
  if (rooms.length === 0) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  const room = rooms[0];
  const now = new Date();
  if (room.expiresAt < now) {
    res.status(404).json({ error: "Room has expired" });
    return;
  }

  const files = await db.select().from(filesTable)
    .where(eq(filesTable.id, rawFileId))
    .limit(1);

  if (files.length === 0 || files[0].roomId !== room.id) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  const file = files[0];
  const filePath = path.join(getRoomDir(room.id), file.storedName);

  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "File not found on disk" });
    return;
  }

  res.setHeader("Content-Disposition", `attachment; filename="${file.originalName}"`);
  res.setHeader("Content-Type", "application/octet-stream");
  res.sendFile(filePath, { root: "/" });
});

router.delete("/rooms/:roomName/files/:fileId", async (req, res): Promise<void> => {
  const rawName = Array.isArray(req.params.roomName) ? req.params.roomName[0] : req.params.roomName;
  const rawFileId = Array.isArray(req.params.fileId) ? req.params.fileId[0] : req.params.fileId;

  const rooms = await db.select().from(roomsTable).where(eq(roomsTable.name, rawName)).limit(1);
  if (rooms.length === 0) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  const room = rooms[0];

  const files = await db.select().from(filesTable)
    .where(eq(filesTable.id, rawFileId))
    .limit(1);

  if (files.length === 0 || files[0].roomId !== room.id) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  const file = files[0];
  const filePath = path.join(getRoomDir(room.id), file.storedName);

  try {
    fs.unlinkSync(filePath);
  } catch {
  }

  await db.delete(filesTable).where(eq(filesTable.id, rawFileId));

  const io = (req as any).app.get("io");
  if (io) {
    io.to(`room:${rawName}`).emit("file:deleted", { id: rawFileId });
  }

  res.json({ success: true });
});

export default router;
