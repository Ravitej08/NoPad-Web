import { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { useQueryClient } from "@tanstack/react-query";
import { 
  getListFilesQueryKey, 
  getListBlocksQueryKey,
  getGetRoomQueryKey
} from "@workspace/api-client-react";
import type { FileRecord, TextBlock, Room } from "@workspace/api-client-react";

export function useSocket(roomName: string) {
  const socketRef = useRef<Socket | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!roomName) return;

    // Connect to same origin
    const socket = io({
      path: "/ws/socket.io",
      transports: ["websocket", "polling"],
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      socket.emit("join:room", { roomName });
    });

    socket.on("file:uploaded", (file: FileRecord) => {
      queryClient.setQueryData<FileRecord[]>(getListFilesQueryKey(roomName), (old) => {
        if (!old) return [file];
        // replace if exists, otherwise append
        const exists = old.some((f) => f.id === file.id);
        if (exists) {
          return old.map((f) => (f.id === file.id ? file : f));
        }
        return [...old, file];
      });
      
      // Update room file count
      queryClient.setQueryData<Room>(getGetRoomQueryKey(roomName), (old) => {
        if (!old) return old;
        return { ...old, fileCount: (old.fileCount || 0) + 1 };
      });
    });

    socket.on("file:deleted", (file: FileRecord) => {
      queryClient.setQueryData<FileRecord[]>(getListFilesQueryKey(roomName), (old) => {
        if (!old) return [];
        return old.filter((f) => f.id !== file.id);
      });
      
      // Update room file count
      queryClient.setQueryData<Room>(getGetRoomQueryKey(roomName), (old) => {
        if (!old) return old;
        return { ...old, fileCount: Math.max(0, (old.fileCount || 1) - 1) };
      });
    });

    socket.on("block:created", (block: TextBlock) => {
      queryClient.setQueryData<TextBlock[]>(getListBlocksQueryKey(roomName), (old) => {
        if (!old) return [block];
        const exists = old.some((b) => b.id === block.id);
        if (exists) return old;
        return [...old, block];
      });
    });

    socket.on("block:updated", (block: TextBlock) => {
      queryClient.setQueryData<TextBlock[]>(getListBlocksQueryKey(roomName), (old) => {
        if (!old) return [block];
        return old.map((b) => (b.id === block.id ? block : b));
      });
    });

    socket.on("block:deleted", (block: TextBlock) => {
      queryClient.setQueryData<TextBlock[]>(getListBlocksQueryKey(roomName), (old) => {
        if (!old) return [];
        return old.filter((b) => b.id !== block.id);
      });
    });

    return () => {
      socket.disconnect();
    };
  }, [roomName, queryClient]);

  return socketRef.current;
}
