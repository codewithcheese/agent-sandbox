import { nanoid } from "nanoid";

// Simple map to store cursors with short IDs
const cursors = new Map<string, string>();

// Map functions
export default {
  // Store a cursor and return a short ID
  store: (cursor: string): string => {
    const id = nanoid(8);
    cursors.set(id, cursor);
    return id;
  },
  
  // Get a cursor by ID
  get: (id: string): string => {
    const cursor = cursors.get(id);
    if (!cursor) {
      throw new Error(`Cursor ID not found: ${id}`);
    }
    return cursor;
  }
};
