import type { Env, FileRecord } from "../types";
import { json, CORS_HEADERS } from "../utils/cors";

const MAX_FILES = 5;
const MAX_SIZE = 25 * 1024 * 1024;

function r2Key(roomName: string, fileId: string): string {
  return `${roomName}/${fileId}`;
}

export async function handleFiles(
  request: Request,
  env: Env,
  roomName: string,
  rest: string,
): Promise<Response> {
  const method = request.method;

  if (rest === "/files" && method === "GET") {
    const listed = await env.FILES.list({ prefix: `${roomName}/` });
    const files: FileRecord[] = listed.objects.map((obj) => {
      const meta = obj.customMetadata ?? {};
      return {
        id: obj.key.slice(`${roomName}/`.length),
        originalName: meta["originalName"] ?? obj.key,
        size: obj.size,
        mimeType: meta["mimeType"] ?? "application/octet-stream",
        uploadedAt: obj.uploaded.toISOString(),
      };
    });
    return json(files);
  }

  if (rest === "/upload" && method === "POST") {
    const listed = await env.FILES.list({ prefix: `${roomName}/` });
    if (listed.objects.length >= MAX_FILES) {
      return json({ error: "Maximum 5 files per room" }, 400);
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) return json({ error: "No file provided" }, 400);
    if (file.size > MAX_SIZE) return json({ error: "File too large (max 25MB)" }, 400);

    const fileId = crypto.randomUUID();
    const key = r2Key(roomName, fileId);

    await env.FILES.put(key, file.stream(), {
      httpMetadata: { contentType: file.type || "application/octet-stream" },
      customMetadata: {
        originalName: file.name,
        mimeType: file.type || "application/octet-stream",
      },
    });

    const record: FileRecord = {
      id: fileId,
      originalName: file.name,
      size: file.size,
      mimeType: file.type || "application/octet-stream",
      uploadedAt: new Date().toISOString(),
    };

    const stub = env.ROOMS.get(env.ROOMS.idFromName(roomName));
    await stub.fetch("http://do/_internal/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "file:uploaded", data: record }),
    });

    return json(record, 201);
  }

  const fileIdMatch = rest.match(/^\/files\/([^/]+)$/);
  if (fileIdMatch) {
    const fileId = fileIdMatch[1]!;
    const key = r2Key(roomName, fileId);

    if (method === "GET") {
      const obj = await env.FILES.get(key);
      if (!obj) return json({ error: "File not found" }, 404);
      const meta = obj.customMetadata ?? {};
      return new Response(obj.body, {
        headers: {
          "Content-Type": meta["mimeType"] ?? "application/octet-stream",
          "Content-Disposition": `attachment; filename="${meta["originalName"] ?? fileId}"`,
          ...CORS_HEADERS,
        },
      });
    }

    if (method === "DELETE") {
      await env.FILES.delete(key);
      const stub = env.ROOMS.get(env.ROOMS.idFromName(roomName));
      await stub.fetch("http://do/_internal/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "file:deleted", data: { id: fileId } }),
      });
      return json({ success: true });
    }
  }

  return json({ error: "Not found" }, 404);
}
