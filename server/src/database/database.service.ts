import { Injectable, OnModuleInit } from '@nestjs/common';
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'fs';
import * as path from 'path';

export type ChatRole = 'user' | 'assistant';

export interface ChatEventRow {
  id: number;
  warom_user_id: string;
  role: ChatRole;
  content: string;
  created_at: string;
}

export interface SuggestionCacheRow {
  warom_user_id: string;
  suggestion: string;
  updated_at: string;
  based_on_event_id: number | null;
}

@Injectable()
export class DatabaseService implements OnModuleInit {
  private db!: DatabaseSync;

  onModuleInit() {
    const dir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(path.join(dir, 'habits.sqlite'));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chat_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        warom_user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_chat_events_user_created
        ON chat_events (warom_user_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS suggestion_cache (
        warom_user_id TEXT PRIMARY KEY,
        suggestion TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        based_on_event_id INTEGER
      );
    `);
  }

  insertChatEvent(waromUserId: string, role: ChatRole, content: string): ChatEventRow {
    this.db
      .prepare(
        `INSERT INTO chat_events (warom_user_id, role, content) VALUES (?, ?, ?)`,
      )
      .run(waromUserId, role, content);
    const row = this.db
      .prepare(`SELECT * FROM chat_events WHERE warom_user_id = ? ORDER BY id DESC LIMIT 1`)
      .get(waromUserId) as unknown as ChatEventRow;
    return row;
  }

  listRecentUserMessages(waromUserId: string, limit: number): ChatEventRow[] {
    return this.db
      .prepare(
        `SELECT * FROM chat_events
         WHERE warom_user_id = ? AND role = 'user'
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(waromUserId, limit) as unknown as ChatEventRow[];
  }

  latestUserEventId(waromUserId: string): number | null {
    const row = this.db
      .prepare(
        `SELECT id FROM chat_events
         WHERE warom_user_id = ? AND role = 'user'
         ORDER BY id DESC LIMIT 1`,
      )
      .get(waromUserId) as unknown as { id: number } | undefined;
    return row ? row.id : null;
  }

  getSuggestionCache(waromUserId: string): SuggestionCacheRow | undefined {
    return this.db
      .prepare(`SELECT * FROM suggestion_cache WHERE warom_user_id = ?`)
      .get(waromUserId) as unknown as SuggestionCacheRow | undefined;
  }

  upsertSuggestion(waromUserId: string, suggestion: string, basedOnEventId: number | null) {
    this.db
      .prepare(
        `INSERT INTO suggestion_cache (warom_user_id, suggestion, updated_at, based_on_event_id)
         VALUES (?, ?, datetime('now'), ?)
         ON CONFLICT(warom_user_id) DO UPDATE SET
           suggestion = excluded.suggestion,
           updated_at = excluded.updated_at,
           based_on_event_id = excluded.based_on_event_id`,
      )
      .run(waromUserId, suggestion, basedOnEventId);
  }
}
