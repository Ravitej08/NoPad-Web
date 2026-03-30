import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileWarning } from "lucide-react";

export function Home() {
  const [_, setLocation] = useLocation();
  const [roomName, setRoomName] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = roomName.trim();
    if (!name) {
      setError("Room name cannot be empty");
      return;
    }
    if (!/^[a-zA-Z0-9]{1,20}$/.test(name)) {
      setError("Room name must be 1-20 alphanumeric characters");
      return;
    }
    setLocation(`/${name}`);
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold tracking-tight">nopad</h1>
          <p className="text-muted-foreground">No login required.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-center space-x-2">
            <div className="text-xl font-medium text-muted-foreground">nopad/</div>
            <Input
              data-testid="input-room-name"
              type="text"
              placeholder="room-name"
              value={roomName}
              onChange={(e) => {
                setRoomName(e.target.value);
                setError("");
              }}
              className="text-lg h-12 flex-1"
              maxLength={20}
              autoFocus
            />
            <Button data-testid="button-go" type="submit" size="lg" className="h-12 px-8">
              Go
            </Button>
          </div>
          {error && (
            <div className="text-destructive text-sm flex items-center gap-1">
              <FileWarning className="w-4 h-4" />
              <span>{error}</span>
            </div>
          )}
        </form>

        <div className="text-center text-xs text-muted-foreground">
          <p>This is for educational purpose.</p>
          <p className="mt-1">Everything disappears when the room expires.</p>
        </div>
      </div>
    </div>
  );
}

export default Home;
