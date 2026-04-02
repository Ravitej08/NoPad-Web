export interface Env {
  ROOMS: DurableObjectNamespace;
  FILES: R2Bucket;
}

export interface Room {
  id: string;
  name: string;
  createdAt: string;
  expiresAt: string;
}

export interface Block {
  id: string;
  roomId: string;
  content: string;
  ownerId: string | null;
  committed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FileRecord {
  id: string;
  originalName: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
}
