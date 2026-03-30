import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import {
  useGetRoom,
  useListFiles,
  useListBlocks,
  useCreateBlock,
  useUpdateBlock,
  useDeleteBlock,
  useCommitBlock,
  useDeleteFile,
  getGetRoomQueryKey,
} from "@workspace/api-client-react";
import type { TextBlock, FileRecord } from "@workspace/api-client-react";
import { useOwnerId } from "@/hooks/use-owner-id";
import { useSocket } from "@/hooks/use-socket";
import { useTheme } from "@/components/theme-provider";
import { format, differenceInSeconds } from "date-fns";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import {
  Copy,
  Download,
  Trash2,
  File as FileIcon,
  FileImage,
  FileText,
  FileArchive,
  FileSpreadsheet,
  FileCode,
  Plus,
  Lock,
  Unlock,
  Settings,
  Clock,
  UploadCloud,
  ChevronLeft,
} from "lucide-react";

const getFileIcon = (mimeType: string) => {
  if (mimeType.startsWith("image/")) return FileImage;
  if (mimeType.includes("pdf") || mimeType.includes("text/")) return FileText;
  if (mimeType.includes("zip") || mimeType.includes("compressed")) return FileArchive;
  if (mimeType.includes("spreadsheet") || mimeType.includes("csv") || mimeType.includes("excel")) return FileSpreadsheet;
  if (mimeType.includes("javascript") || mimeType.includes("python") || mimeType.includes("java")) return FileCode;
  return FileIcon;
};

const formatBytes = (bytes: number) => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};

function CountdownTimer({ expiresAt }: { expiresAt: string }) {
  const [timeLeft, setTimeLeft] = useState("");

  useEffect(() => {
    const updateTimer = () => {
      const now = new Date();
      const expiry = new Date(expiresAt);
      const diff = differenceInSeconds(expiry, now);
      
      if (diff <= 0) {
        setTimeLeft("Expired");
        return;
      }
      
      const hours = Math.floor(diff / 3600);
      const mins = Math.floor((diff % 3600) / 60);
      const secs = diff % 60;
      
      setTimeLeft(
        `${hours > 0 ? `${hours}h ` : ""}${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
      );
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  return <span className="font-mono text-sm tabular-nums">{timeLeft}</span>;
}

export function Room() {
  const params = useParams();
  const roomName = params.roomName as string;
  const [_, setLocation] = useLocation();
  const ownerId = useOwnerId();
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();
  
  // Real-time setup
  useSocket(roomName);

  const { data: room, isLoading: isLoadingRoom, isError: isErrorRoom } = useGetRoom(roomName, {
    query: { enabled: !!roomName, queryKey: getGetRoomQueryKey(roomName), retry: false }
  });

  const { data: files = [] } = useListFiles(roomName, {
    query: { enabled: !!room && !!roomName }
  });

  const { data: blocks = [] } = useListBlocks(roomName, {
    query: { enabled: !!room && !!roomName }
  });

  const createBlock = useCreateBlock();
  const updateBlock = useUpdateBlock();
  const deleteBlock = useDeleteBlock();
  const commitBlock = useCommitBlock();
  const deleteFile = useDeleteFile();

  const handleCreateBlock = () => {
    if (!ownerId) return;
    createBlock.mutate({ roomName, data: { ownerId } });
  };

  if (isErrorRoom) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4">
        <h2 className="text-2xl font-bold mb-4">Room not found or expired</h2>
        <Button onClick={() => setLocation("/")}>Go Home</Button>
      </div>
    );
  }

  if (isLoadingRoom || !room) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center">
        <div className="animate-pulse flex flex-col items-center">
          <div className="h-8 w-32 bg-muted rounded mb-4"></div>
          <div className="h-4 w-48 bg-muted rounded"></div>
        </div>
      </div>
    );
  }

  const isExpired = new Date(room.expiresAt) <= new Date();

  if (isExpired) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-destructive/10">
        <div className="text-center space-y-4">
          <Clock className="w-16 h-16 text-destructive mx-auto" />
          <h2 className="text-3xl font-bold text-destructive">This room has expired</h2>
          <p className="text-muted-foreground">All contents have been permanently deleted.</p>
          <Button variant="outline" onClick={() => setLocation("/")} className="mt-8">
            Create a new room
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col max-w-4xl mx-auto w-full pb-32">
      {/* Top Bar */}
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/")} className="h-8 w-8">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="font-bold tracking-tight leading-none">nopad/{room.name}</h1>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
              <Clock className="w-3 h-3" />
              <span>Expires in: </span>
              <CountdownTimer expiresAt={room.expiresAt} />
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="h-8 w-8">
                <Settings className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setTheme("white")}>
                Light Theme
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("black")}>
                Dark Theme
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("hacker")}>
                Hacker Theme
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <main className="flex-1 flex flex-col p-4 gap-8">
        
        {/* Files Section */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-wider uppercase text-muted-foreground">Files</h2>
            <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-full font-mono">
              {files.length}/5 files
            </span>
          </div>
          
          <div className="flex overflow-x-auto gap-4 pb-4 snap-x">
            {files.length === 0 ? (
              <div className="w-full h-24 border-2 border-dashed rounded-lg flex items-center justify-center text-muted-foreground text-sm">
                No files yet
              </div>
            ) : (
              files.map((file) => (
                <FileCard 
                  key={file.id} 
                  file={file} 
                  roomName={roomName}
                  onDelete={() => deleteFile.mutate({ roomName, fileId: file.id })}
                />
              ))
            )}
          </div>
        </section>

        {/* Word Count Warning */}
        {room.wordCount > 18000 && (
          <div className="bg-destructive/10 text-destructive border border-destructive/20 rounded-md p-3 text-sm flex items-center justify-between">
            <span>Room approaching word limit ({room.wordCount}/20,000 words)</span>
          </div>
        )}

        {/* Blocks Section */}
        <section className="space-y-4 flex-1">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-wider uppercase text-muted-foreground">Text Blocks</h2>
            <Button size="sm" onClick={handleCreateBlock} className="gap-1 h-8">
              <Plus className="w-3.5 h-3.5" /> New Block
            </Button>
          </div>
          
          <div className="space-y-4">
            {blocks.map((block) => (
              <BlockCard 
                key={block.id} 
                block={block} 
                roomName={roomName} 
                ownerId={ownerId} 
              />
            ))}
            
            {blocks.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <FileText className="w-12 h-12 mx-auto mb-3 opacity-20" />
                <p>No text blocks yet. Create one to start typing.</p>
              </div>
            )}
          </div>
        </section>

      </main>

      {/* Upload Area (Fixed Bottom) */}
      <UploadArea roomName={roomName} maxFilesReached={files.length >= 5} />
    </div>
  );
}

function FileCard({ file, roomName, onDelete }: { file: FileRecord, roomName: string, onDelete: () => void }) {
  const Icon = getFileIcon(file.mimeType);
  const { toast } = useToast();
  
  const downloadUrl = `/api/rooms/${roomName}/files/${file.id}`;
  
  const handleCopyLink = () => {
    const url = new URL(downloadUrl, window.location.origin).toString();
    navigator.clipboard.writeText(url);
    toast({ description: "File link copied to clipboard" });
  };
  
  return (
    <Card className="min-w-[200px] max-w-[240px] flex-shrink-0 snap-start overflow-hidden">
      <CardContent className="p-3">
        <div className="flex items-start gap-3">
          <div className="bg-primary/10 text-primary p-2 rounded-md">
            <Icon className="w-6 h-6" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate" title={file.originalName}>
              {file.originalName}
            </p>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">
              {formatBytes(file.size)}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-1 mt-4 pt-3 border-t">
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={handleCopyLink} title="Copy Link">
            <Copy className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" asChild title="Download">
            <a href={downloadUrl} download={file.originalName}>
              <Download className="w-3.5 h-3.5" />
            </a>
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={onDelete} title="Delete">
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function BlockCard({ block, roomName, ownerId }: { block: TextBlock, roomName: string, ownerId: string }) {
  const [content, setContent] = useState(block.content);
  const { toast } = useToast();
  const updateBlock = useUpdateBlock();
  const deleteBlock = useDeleteBlock();
  const commitBlock = useCommitBlock();
  
  const isOwner = block.ownerId === ownerId;
  const isCommittedAndNotOwner = block.committed && !isOwner && block.ownerId != null;
  
  const lastSaved = useRef(block.content);
  
  // Sync from server if not currently editing (basic approach)
  useEffect(() => {
    if (block.content !== lastSaved.current) {
      setContent(block.content);
      lastSaved.current = block.content;
    }
  }, [block.content]);

  // Debounced save
  useEffect(() => {
    if (content === lastSaved.current || isCommittedAndNotOwner) return;
    
    const timer = setTimeout(() => {
      updateBlock.mutate({ 
        roomName, 
        blockId: block.id, 
        data: { content, ownerId } 
      });
      lastSaved.current = content;
    }, 500);
    
    return () => clearTimeout(timer);
  }, [content, roomName, block.id, ownerId, updateBlock, isCommittedAndNotOwner]);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    toast({ description: "Block content copied" });
  };

  const handleDelete = () => {
    deleteBlock.mutate({ roomName, blockId: block.id, data: { ownerId } });
  };

  const handleToggleCommit = () => {
    commitBlock.mutate({ roomName, blockId: block.id, data: { ownerId } });
  };

  return (
    <Card className="overflow-hidden border-border group">
      <div className="p-1.5 flex items-center justify-between border-b bg-muted/30">
        <div className="flex items-center gap-2 px-2">
          <span className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground">
            Updated: {format(new Date(block.updatedAt), "h:mm a")}
          </span>
          {block.committed && (
            <span className="flex items-center gap-1 text-[10px] font-semibold bg-primary/10 text-primary px-1.5 py-0.5 rounded uppercase tracking-wider">
              <Lock className="w-3 h-3" /> Locked
            </span>
          )}
        </div>
        
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCopy} title="Copy content">
            <Copy className="w-3.5 h-3.5" />
          </Button>
          
          {!isCommittedAndNotOwner && (
            <>
              <Button variant="ghost" size="icon" className={`h-6 w-6 ${block.committed ? 'text-primary' : ''}`} onClick={handleToggleCommit} title={block.committed ? "Uncommit" : "Commit"}>
                {block.committed ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
              </Button>
              <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive" onClick={handleDelete} title="Delete block">
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>
      
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        readOnly={isCommittedAndNotOwner}
        className="min-h-[100px] border-0 rounded-none focus-visible:ring-0 resize-none font-mono text-sm leading-relaxed p-4"
        placeholder={isCommittedAndNotOwner ? "" : "Type something..."}
      />
    </Card>
  );
}

function UploadArea({ roomName, maxFilesReached }: { roomName: string, maxFilesReached: boolean }) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (files: FileList | File[]) => {
    if (maxFilesReached) {
      toast({ title: "Limit reached", description: "Maximum of 5 files per room allowed", variant: "destructive" });
      return;
    }
    if (files.length === 0) return;
    
    const file = files[0];
    if (file.size > 25 * 1024 * 1024) {
      toast({ title: "File too large", description: "Maximum file size is 25MB", variant: "destructive" });
      return;
    }

    setIsUploading(true);
    setProgress(0);

    const formData = new FormData();
    formData.append("file", file);

    try {
      // Use XMLHttpRequest for progress tracking
      const xhr = new XMLHttpRequest();
      
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const p = Math.round((event.loaded / event.total) * 100);
          setProgress(p);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          toast({ description: "File uploaded successfully" });
          if (fileInputRef.current) fileInputRef.current.value = "";
        } else {
          try {
            const res = JSON.parse(xhr.responseText);
            toast({ title: "Upload failed", description: res.error || "Unknown error", variant: "destructive" });
          } catch {
            toast({ title: "Upload failed", description: "Server error", variant: "destructive" });
          }
        }
        setIsUploading(false);
      };

      xhr.onerror = () => {
        toast({ title: "Upload failed", description: "Network error", variant: "destructive" });
        setIsUploading(false);
      };

      xhr.open("POST", `/api/rooms/${roomName}/upload`, true);
      xhr.send(formData);
    } catch (err) {
      toast({ title: "Upload failed", variant: "destructive" });
      setIsUploading(false);
    }
  };

  return (
    <div 
      className={`fixed bottom-0 left-0 right-0 p-4 bg-background/95 backdrop-blur border-t transition-colors ${isDragging ? 'bg-primary/5 border-primary' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files) handleUpload(e.dataTransfer.files);
      }}
    >
      <div className="max-w-4xl mx-auto flex items-center gap-4">
        <input 
          type="file" 
          ref={fileInputRef} 
          className="hidden" 
          onChange={(e) => { if (e.target.files) handleUpload(e.target.files); }}
          disabled={isUploading || maxFilesReached}
          accept=".pdf,.docx,.xlsx,.pptx,.txt,.csv,.png,.jpg,.jpeg,.gif,.zip,.js,.py,.java,.c,.cpp"
        />
        <Button 
          variant="outline" 
          className="w-full border-dashed h-12 bg-muted/50 hover:bg-muted font-normal text-muted-foreground flex justify-start px-4 gap-3"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading || maxFilesReached}
        >
          <UploadCloud className="w-5 h-5" />
          {isUploading ? (
            <div className="flex-1 flex items-center gap-3">
              <span className="text-sm">Uploading... {progress}%</span>
              <Progress value={progress} className="h-1 flex-1" />
            </div>
          ) : maxFilesReached ? (
            <span>Max 5 files reached. Delete a file to upload.</span>
          ) : (
            <span>Drag & drop a file here, or click to browse (Max 25MB)</span>
          )}
        </Button>
      </div>
    </div>
  );
}

export default Room;
