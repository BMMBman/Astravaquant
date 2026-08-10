import type { SessionRecord } from "../database.js";

declare global {
  namespace Express {
    interface Request {
      astravaSession?: SessionRecord;
    }
  }
}

export {};
