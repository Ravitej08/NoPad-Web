import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListFilesQueryKey,
  getListBlocksQueryKey,
  getGetRoomQueryKey,
} from "@workspace/api-client-react";
import type { FileRecord, TextBlock, Room } from "@workspace/api-client-react";

// Set VITE_WS_BASE_URL to your Cloudflare Worker URL to enable native WebSocket
// e.g. https://nopad.your-account.workers.dev
// When unset, falls back to socket.io (Replit dev mode)
const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL as string | undefined;

function useNativeSocket(roomName: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!roomName || !WS_BASE_URL) return;

    const wsUrl =
      WS_BASE_URL.replace(/^https?/, (m) => (m === "https" ? "wss" : "ws")) +
      `/api/rooms/${roomName}/ws`;

    let ws: WebSocket;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    function connect() {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        if (retryTimer) {
          clearTimeout(retryTimer);
          retryTimer = null;
        }
      };

      ws.onmessage = (ev) => {
        try {
          const { event, data } = JSON.parse(ev.data as string) as {
            event: string;
            data: unknown;
          };

          if (event === "file:uploaded") {
            const file = data as FileRecord;
            queryClient.setQueryData<FileRecord[]>(
              getListFilesQueryKey(roomName),
              (old) => {
                if (!old) return [file];
                const exists = old.some((f) => f.id === file.id);
                return exists ? old.map((f) => (f.id === file.id ? file : f)) : [...old, file];
              },
            );
            queryClient.setQueryData<Room>(getGetRoomQueryKey(roomName), (old) =>
              old ? { ...old, fileCount: (old.fileCount ?? 0) + 1 } : old,
            );
          }

          if (event === "file:deleted") {
            const file = data as { id: string };
            queryClient.setQueryData<FileRecord[]>(
              getListFilesQueryKey(roomName),
              (old) => old?.filter((f) => f.id !== file.id) ?? [],
            );
            queryClient.setQueryData<Room>(getGetRoomQueryKey(roomName), (old) =>
              old ? { ...old, fileCount: Math.max(0, (old.fileCount ?? 1) - 1) } : old,
            );
          }

          if (event === "block:created") {
            const block = data as TextBlock;
            queryClient.setQueryData<TextBlock[]>(
              getListBlocksQueryKey(roomName),
              (old) => {
                if (!old) return [block];
                return old.some((b) => b.id === block.id) ? old : [...old, block];
              },
            );
          }

          if (event === "block:updated") {
            const block = data as TextBlock;
            queryClient.setQueryData<TextBlock[]>(
              getListBlocksQueryKey(roomName),
              (old) => old?.map((b) => (b.id === block.id ? block : b)) ?? [block],
            );
          }

          if (event === "block:deleted") {
            const block = data as { id: string };
            queryClient.setQueryData<TextBlock[]>(
              getListBlocksQueryKey(roomName),
              (old) => old?.filter((b) => b.id !== block.id) ?? [],
            );
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (!closed) {
          retryTimer = setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      ws?.close();
    };
  }, [roomName, queryClient]);
}

function useSocketIo(roomName: string) {
  const socketRef = useRef<import("socket.io-client").Socket | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!roomName) return;

    let socket: import("socket.io-client").Socket;

    import("socket.io-client").then(({ io }) => {
      socket = io({ path: "/ws/socket.io", transports: ["websocket", "polling"] });
      socketRef.current = socket;

      socket.on("connect", () => socket.emit("join:room", { roomName }));

      socket.on("file:uploaded", (file: FileRecord) => {
        queryClient.setQueryData<FileRecord[]>(getListFilesQueryKey(roomName), (old) => {
          if (!old) return [file];
          const exists = old.some((f) => f.id === file.id);
          return exists ? old.map((f) => (f.id === file.id ? file : f)) : [...old, file];
        });
        queryClient.setQueryData<Room>(getGetRoomQueryKey(roomName), (old) =>
          old ? { ...old, fileCount: (old.fileCount ?? 0) + 1 } : old,
        );
      });

      socket.on("file:deleted", (file: FileRecord) => {
        queryClient.setQueryData<FileRecord[]>(getListFilesQueryKey(roomName), (old) =>
          old?.filter((f) => f.id !== file.id) ?? [],
        );
        queryClient.setQueryData<Room>(getGetRoomQueryKey(roomName), (old) =>
          old ? { ...old, fileCount: Math.max(0, (old.fileCount ?? 1) - 1) } : old,
        );
      });

      socket.on("block:created", (block: TextBlock) => {
        queryClient.setQueryData<TextBlock[]>(getListBlocksQueryKey(roomName), (old) => {
          if (!old) return [block];
          return old.some((b) => b.id === block.id) ? old : [...old, block];
        });
      });

      socket.on("block:updated", (block: TextBlock) => {
        queryClient.setQueryData<TextBlock[]>(getListBlocksQueryKey(roomName), (old) =>
          old?.map((b) => (b.id === block.id ? block : b)) ?? [block],
        );
      });

      socket.on("block:deleted", (block: TextBlock) => {
        queryClient.setQueryData<TextBlock[]>(getListBlocksQueryKey(roomName), (old) =>
          old?.filter((b) => b.id !== block.id) ?? [],
        );
      });
    });

    return () => {
      socket?.disconnect();
    };
  }, [roomName, queryClient]);

  return socketRef.current;
}

export function useSocket(roomName: string) {
  const isCloudflare = !!WS_BASE_URL;

  // Always call both hooks — only the active one does real work
  useNativeSocket(roomName);
  useSocketIo(isCloudflare ? "" : roomName);
}
