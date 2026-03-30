import { db, roomsTable, filesTable, blocksTable } from "@workspace/db";
import { eq, lt } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";
import { logger } from "./logger";

export const ROOM_TTL_MS = 20 * 60 * 1000;
export const MAX_FILES_PER_ROOM = 5;
export const MAX_FILE_SIZE_MB = 25;
export const MAX_WORD_COUNT = 20000;

const ALLOWED_EXTENSIONS = new Set([
  "pdf", "docx", "xlsx", "pptx", "txt", "csv",
  "png", "jpg", "jpeg", "gif",
  "zip",
  "js", "py", "java", "c", "cpp",
]);

const BLOCKED_EXTENSIONS = new Set([
  "exe", "msi", "bat", "sh", "apk", "dll", "sys",
]);

const ALLOWED_MIMES: Record<string, string[]> = {
  "pdf": ["application/pdf"],
  "docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  "xlsx": ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  "pptx": ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  "txt": ["text/plain"],
  "csv": ["text/csv", "application/csv", "text/plain"],
  "png": ["image/png"],
  "jpg": ["image/jpeg"],
  "jpeg": ["image/jpeg"],
  "gif": ["image/gif"],
  "zip": ["application/zip", "application/x-zip-compressed"],
  "js": ["application/javascript", "text/javascript"],
  "py": ["text/x-python", "application/x-python", "text/plain"],
  "java": ["text/x-java", "text/plain", "application/octet-stream"],
  "c": ["text/x-c", "text/plain", "application/octet-stream"],
  "cpp": ["text/x-c++", "text/plain", "application/octet-stream"],
};

export function validateRoomName(name: string): boolean {
  return /^[a-zA-Z0-9]{1,20}$/.test(name);
}

export function getRoomDir(roomId: string): string {
  return path.join("/tmp", "nopad", roomId);
}

export async function getOrCreateRoom(name: string) {
  const existing = await db
    .select()
    .from(roomsTable)
    .where(eq(roomsTable.name, name))
    .limit(1);

  if (existing.length > 0) {
    const room = existing[0];
    const now = new Date();
    if (room.expiresAt < now) {
      await cleanupRoom(room.id);
    } else {
      return room;
    }
  }

  const id = uuidv4();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ROOM_TTL_MS);

  const [room] = await db.insert(roomsTable).values({
    id,
    name,
    createdAt: now,
    expiresAt,
  }).returning();

  const dir = getRoomDir(id);
  fs.mkdirSync(dir, { recursive: true });

  return room;
}

export async function cleanupRoom(roomId: string) {
  const dir = getRoomDir(roomId);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    logger.warn({ err, roomId }, "Failed to remove room directory");
  }
  await db.delete(roomsTable).where(eq(roomsTable.id, roomId));
}

export async function cleanupExpiredRooms() {
  const now = new Date();
  const expired = await db
    .select()
    .from(roomsTable)
    .where(lt(roomsTable.expiresAt, now));

  for (const room of expired) {
    logger.info({ roomId: room.id, name: room.name }, "Cleaning up expired room");
    await cleanupRoom(room.id);
  }

  if (expired.length > 0) {
    logger.info({ count: expired.length }, "Cleaned up expired rooms");
  }
}

export function validateFileExtension(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (BLOCKED_EXTENSIONS.has(ext)) return false;
  return ALLOWED_EXTENSIONS.has(ext);
}

export function validateFileMime(filename: string, mimeType: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const allowed = ALLOWED_MIMES[ext];
  if (!allowed) return false;
  return allowed.some(m => mimeType.startsWith(m.split("/")[0]) && mimeType.includes(m.split("/")[1]));
}

export function countWords(blocks: { content: string }[]): number {
  const combined = blocks.map(b => b.content).join(" ");
  if (!combined.trim()) return 0;
  return combined.trim().split(/\s+/).length;
}
