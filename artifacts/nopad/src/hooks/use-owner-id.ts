import { useState, useEffect } from "react";
import { v4 as uuidv4 } from "uuid";

const OWNER_ID_KEY = "nopad_owner_id";

export function useOwnerId() {
  const [ownerId, setOwnerId] = useState<string>("");

  useEffect(() => {
    let id = localStorage.getItem(OWNER_ID_KEY);
    if (!id) {
      id = uuidv4();
      localStorage.setItem(OWNER_ID_KEY, id);
    }
    setOwnerId(id);
  }, []);

  return ownerId;
}
