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

export type TaskRunStatus = 'planned' | 'running' | 'done' | 'failed' | 'cancelled';
export type TaskStepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface TaskRunRow {
  id: number;
  warom_user_id: string;
  utterance: string;
  reply: string;
  status: TaskRunStatus;
  created_at: string;
  updated_at: string;
}

export interface TaskStepRow {
  id: number;
  run_id: number;
  seq: number;
  type: string;
  query: string;
  status: TaskStepStatus;
  result_message: string;
  created_at: string;
  updated_at: string;
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
      CREATE TABLE IF NOT EXISTS task_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        warom_user_id TEXT NOT NULL,
        utterance TEXT NOT NULL,
        reply TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'planned',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_task_runs_user_created
        ON task_runs (warom_user_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS task_steps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id INTEGER NOT NULL,
        seq INTEGER NOT NULL,
        type TEXT NOT NULL,
        query TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        result_message TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(run_id, seq)
      );
      CREATE INDEX IF NOT EXISTS idx_task_steps_run_seq
        ON task_steps (run_id, seq);
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

  /** 最近对话（含 user/assistant），按时间正序返回，便于拼进模型上下文 */
  listRecentChatEvents(waromUserId: string, limit: number): ChatEventRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM chat_events
         WHERE warom_user_id = ?
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(waromUserId, limit) as unknown as ChatEventRow[];
    return rows.slice().reverse();
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

  createTaskRun(waromUserId: string, utterance: string, reply: string): TaskRunRow {
    this.db
      .prepare(
        `INSERT INTO task_runs (warom_user_id, utterance, reply, status)
         VALUES (?, ?, ?, 'planned')`,
      )
      .run(waromUserId, utterance, reply);
    return this.db
      .prepare(`SELECT * FROM task_runs WHERE warom_user_id = ? ORDER BY id DESC LIMIT 1`)
      .get(waromUserId) as unknown as TaskRunRow;
  }

  insertTaskSteps(
    runId: number,
    steps: Array<{ seq: number; type: string; query: string }>,
  ): TaskStepRow[] {
    const insert = this.db.prepare(
      `INSERT INTO task_steps (run_id, seq, type, query, status) VALUES (?, ?, ?, ?, 'pending')`,
    );
    for (const step of steps) {
      insert.run(runId, step.seq, step.type, step.query || '');
    }
    return this.listTaskSteps(runId);
  }

  listTaskSteps(runId: number): TaskStepRow[] {
    return this.db
      .prepare(`SELECT * FROM task_steps WHERE run_id = ? ORDER BY seq ASC`)
      .all(runId) as unknown as TaskStepRow[];
  }

  getTaskRun(runId: number): TaskRunRow | undefined {
    return this.db
      .prepare(`SELECT * FROM task_runs WHERE id = ?`)
      .get(runId) as unknown as TaskRunRow | undefined;
  }

  updateTaskRunStatus(runId: number, status: TaskRunStatus) {
    this.db
      .prepare(
        `UPDATE task_runs SET status = ?, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(status, runId);
  }

  updateTaskStep(
    runId: number,
    seq: number,
    status: TaskStepStatus,
    resultMessage: string,
  ): TaskStepRow | undefined {
    this.db
      .prepare(
        `UPDATE task_steps
         SET status = ?, result_message = ?, updated_at = datetime('now')
         WHERE run_id = ? AND seq = ?`,
      )
      .run(status, resultMessage || '', runId, seq);
    return this.db
      .prepare(`SELECT * FROM task_steps WHERE run_id = ? AND seq = ?`)
      .get(runId, seq) as unknown as TaskStepRow | undefined;
  }
}
