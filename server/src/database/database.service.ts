import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
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
  id: number;
  warom_user_id: string;
  content: string;
  updated_at: string;
  based_on_event_id: number | null;
}

export type TaskRunStatus = 'planned' | 'running' | 'done' | 'failed' | 'cancelled' | 'waiting';
export type TaskStepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface TaskRunRow {
  id: number;
  warom_user_id: string;
  utterance: string;
  reply: string;
  status: TaskRunStatus;
  created_at: string;
  updated_at: string;
  durable?: number;
  recurring?: number;
  wait_note?: string;
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
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private db!: DatabaseSync;
  private purgeTimer: ReturnType<typeof setInterval> | null = null;
  /** 对话和任务只留最近这么多天。suggestion_cache 不参与清理。 */
  private static readonly RETENTION_DAYS = 5;

  onModuleInit() {
    const dir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(path.join(dir, 'habits.sqlite'), { timeout: 1500 });
    try {
      this.db.exec('PRAGMA journal_mode = WAL;');
    } catch (error) {
      // 数据库工具正打开文件时切 WAL 会拿不到独占锁，查询仍可继续
    }
    try {
      this.db.exec('PRAGMA busy_timeout = 1500;');
    } catch (error) {
      // 忽略
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chat_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        warom_user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_chat_events_user_created
        ON chat_events (warom_user_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS suggestion_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        warom_user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        based_on_event_id INTEGER
      );
      CREATE TABLE IF NOT EXISTS task_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        warom_user_id TEXT NOT NULL,
        utterance TEXT NOT NULL,
        reply TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'planned',
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
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
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        UNIQUE(run_id, seq)
      );
      CREATE INDEX IF NOT EXISTS idx_task_steps_run_seq
        ON task_steps (run_id, seq);
    `);
    this.ensureTaskRunColumn('durable', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureTaskRunColumn('recurring', 'INTEGER NOT NULL DEFAULT 0');
    this.ensureTaskRunColumn('wait_note', "TEXT NOT NULL DEFAULT ''");
    try {
      this.migrateSuggestionCache();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[suggestion_cache] 表结构还没改完：${message}`);
    }
    try {
      const removed = this.purgeExpiredRows();
      const total = removed.chatEvents + removed.taskRuns + removed.taskSteps;
      if (total) {
        console.log(`[retention] 已删除超过 ${DatabaseService.RETENTION_DAYS} 天的数据：对话 ${removed.chatEvents}，任务 ${removed.taskRuns}，步骤 ${removed.taskSteps}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[retention] 清理失败：${message}`);
    }
    this.purgeTimer = setInterval(() => {
      try {
        this.purgeExpiredRows();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[retention] 清理失败：${message}`);
      }
    }, 6 * 60 * 60 * 1000);
  }

  onModuleDestroy() {
    if (this.purgeTimer) clearInterval(this.purgeTimer);
    this.purgeTimer = null;
  }

  /** 删除五天前的对话、任务和对应步骤。suggestion_cache 整表保留。 */
  purgeExpiredRows(days = DatabaseService.RETENTION_DAYS) {
    const cutoff = `-${Math.max(1, Number(days) || DatabaseService.RETENTION_DAYS)} days`;
    const before = (column: string) => `${column} < datetime('now', 'localtime', ?)`;
    const changes = (result: { changes?: number | bigint }) => Number(result?.changes || 0);
    this.db.exec('BEGIN');
    try {
      const chatEvents = changes(this.db
        .prepare(`DELETE FROM chat_events WHERE ${before('created_at')}`)
        .run(cutoff));
      const taskSteps = changes(this.db
        .prepare(
          `DELETE FROM task_steps WHERE run_id IN (
             SELECT id FROM task_runs WHERE ${before('updated_at')}
           )`,
        )
        .run(cutoff));
      const taskRuns = changes(this.db
        .prepare(`DELETE FROM task_runs WHERE ${before('updated_at')}`)
        .run(cutoff));
      this.db
        .prepare(`DELETE FROM task_steps WHERE run_id NOT IN (SELECT id FROM task_runs)`)
        .run();
      this.db.exec('COMMIT');
      return { chatEvents, taskRuns, taskSteps };
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch (rollbackError) {
        // 事务没开成时保留原始错误
      }
      throw error;
    }
  }

  /** 关掉占用库的工具后，下一次读写会再试一次改表。 */
  ensureSuggestionSchema() {
    this.migrateSuggestionCache();
  }

  /** 旧表用 slot/suggestion，序号和正文容易看错列。改成 id + content。 */
  private migrateSuggestionCache() {
    const cols = this.db.prepare('PRAGMA table_info(suggestion_cache)').all() as unknown as Array<{ name: string }>;
    const names = cols.map((col) => col.name);
    if (names.includes('id') && names.includes('content') && !names.includes('slot')) return;
    const textColumn = names.includes('content') ? 'content' : names.includes('suggestion') ? 'suggestion' : '';
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS suggestion_cache_v3 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        warom_user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        based_on_event_id INTEGER
      );
    `);
    if (textColumn) {
      const existing = this.db.prepare(`SELECT COUNT(*) AS n FROM suggestion_cache_v3`).get() as { n: number };
      if (!Number(existing?.n)) {
        this.db.exec(`
          INSERT INTO suggestion_cache_v3 (warom_user_id, content, updated_at, based_on_event_id)
          SELECT warom_user_id, ${textColumn}, updated_at, based_on_event_id
          FROM suggestion_cache
          WHERE trim(COALESCE(${textColumn}, '')) != '';
        `);
      }
    }
    this.db.exec(`
      DROP TABLE suggestion_cache;
      ALTER TABLE suggestion_cache_v3 RENAME TO suggestion_cache;
      CREATE INDEX IF NOT EXISTS idx_suggestion_cache_user
        ON suggestion_cache (warom_user_id, id);
    `);
  }

  private ensureTaskRunColumn(name: string, ddl: string) {
    const cols = this.db.prepare('PRAGMA table_info(task_runs)').all() as unknown as Array<{ name: string }>;
    if (cols.some((col) => col.name === name)) return;
    this.db.exec(`ALTER TABLE task_runs ADD COLUMN ${name} ${ddl}`);
  }

  insertChatEvent(waromUserId: string, role: ChatRole, content: string): ChatEventRow {
    const text = String(content || '').trim();
    // 防抖：同一用户、同一角色、相同内容在数秒内只保留一条
    const recent = this.db
      .prepare(
        `SELECT * FROM chat_events
         WHERE warom_user_id = ? AND role = ? AND content = ?
           AND created_at >= datetime('now', 'localtime', '-8 seconds')
         ORDER BY id DESC LIMIT 1`,
      )
      .get(waromUserId, role, text) as unknown as ChatEventRow | undefined;
    if (recent) return recent;

    this.db
      .prepare(
        `INSERT INTO chat_events (warom_user_id, role, content, created_at)
         VALUES (?, ?, ?, datetime('now', 'localtime'))`,
      )
      .run(waromUserId, role, text);
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

  /** 改表被占用时，仍按旧列把正文读出来，避免快捷建议整条消失。 */
  listLegacySuggestions(waromUserId: string): SuggestionCacheRow[] {
    const cols = this.db.prepare('PRAGMA table_info(suggestion_cache)').all() as unknown as Array<{ name: string }>;
    const names = cols.map((col) => col.name);
    if (!names.includes('suggestion')) return [];
    const rows = this.db
      .prepare(
        `SELECT warom_user_id, slot, suggestion, updated_at, based_on_event_id
         FROM suggestion_cache WHERE warom_user_id = ? ORDER BY slot ASC`,
      )
      .all(waromUserId) as unknown as Array<{
        warom_user_id: string;
        slot: number;
        suggestion: string;
        updated_at: string;
        based_on_event_id: number | null;
      }>;
    return rows
      .filter((row) => String(row.suggestion || '').trim())
      .map((row) => ({
        id: Number(row.slot),
        warom_user_id: row.warom_user_id,
        content: row.suggestion,
        updated_at: row.updated_at,
        based_on_event_id: row.based_on_event_id,
      }));
  }

  listSuggestions(waromUserId: string): SuggestionCacheRow[] {
    return this.db
      .prepare(
        `SELECT id, warom_user_id, content, updated_at, based_on_event_id
         FROM suggestion_cache WHERE warom_user_id = ? ORDER BY id ASC`,
      )
      .all(waromUserId) as unknown as SuggestionCacheRow[];
  }

  /**
   * 写入最多三条。和库里已有正文完全一样时不更新。
   * 返回是否真正写入。
   */
  replaceSuggestions(waromUserId: string, contents: string[], basedOnEventId: number | null): boolean {
    const next = contents.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 3);
    const prev = this.listSuggestions(waromUserId).map((row) => row.content);
    const same = prev.length === next.length && prev.every((text, index) => text === next[index]);
    if (same) return false;
    this.db.prepare(`DELETE FROM suggestion_cache WHERE warom_user_id = ?`).run(waromUserId);
    const insert = this.db.prepare(
      `INSERT INTO suggestion_cache (warom_user_id, content, updated_at, based_on_event_id)
       VALUES (?, ?, datetime('now', 'localtime'), ?)`,
    );
    next.forEach((text) => {
      insert.run(waromUserId, text, basedOnEventId);
    });
    return true;
  }

  /** 按主键删一条。id 对不上该工号时不动其他行。 */
  deleteSuggestionById(waromUserId: string, id: number): SuggestionCacheRow[] {
    this.db
      .prepare(`DELETE FROM suggestion_cache WHERE warom_user_id = ? AND id = ?`)
      .run(String(waromUserId || '').trim(), id);
    return this.listSuggestions(waromUserId);
  }

  clearSuggestions(waromUserId: string) {
    this.db
      .prepare(`DELETE FROM suggestion_cache WHERE warom_user_id = ?`)
      .run(String(waromUserId || '').trim());
  }

  createTaskRun(waromUserId: string, utterance: string, reply: string): TaskRunRow {
    this.db
      .prepare(
        `INSERT INTO task_runs (warom_user_id, utterance, reply, status, created_at, updated_at)
         VALUES (?, ?, ?, 'planned', datetime('now', 'localtime'), datetime('now', 'localtime'))`,
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
      `INSERT INTO task_steps (run_id, seq, type, query, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', datetime('now', 'localtime'), datetime('now', 'localtime'))`,
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
        `UPDATE task_runs SET status = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`,
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
         SET status = ?, result_message = ?, updated_at = datetime('now', 'localtime')
         WHERE run_id = ? AND seq = ?`,
      )
      .run(status, resultMessage || '', runId, seq);
    return this.db
      .prepare(`SELECT * FROM task_steps WHERE run_id = ? AND seq = ?`)
      .get(runId, seq) as unknown as TaskStepRow | undefined;
  }

  /** 删掉失败步之后尚未执行的步骤，再按新计划接上。 */
  replacePendingTail(
    runId: number,
    afterSeq: number,
    steps: Array<{ type: string; query: string }>,
  ): TaskStepRow[] {
    this.db
      .prepare(
        `DELETE FROM task_steps
         WHERE run_id = ? AND seq > ? AND status IN ('pending', 'running')`,
      )
      .run(runId, afterSeq);
    const maxRow = this.db
      .prepare(`SELECT MAX(seq) AS maxSeq FROM task_steps WHERE run_id = ?`)
      .get(runId) as unknown as { maxSeq: number | null };
    let seq = Number(maxRow?.maxSeq || afterSeq || 0);
    const insert = this.db.prepare(
      `INSERT INTO task_steps (run_id, seq, type, query, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', datetime('now', 'localtime'), datetime('now', 'localtime'))`,
    );
    const inserted: TaskStepRow[] = [];
    for (const step of steps) {
      seq += 1;
      insert.run(runId, seq, step.type, step.query || '');
      const row = this.db
        .prepare(`SELECT * FROM task_steps WHERE run_id = ? AND seq = ?`)
        .get(runId, seq) as unknown as TaskStepRow;
      if (row) inserted.push(row);
    }
    this.updateTaskRunStatus(runId, 'running');
    return inserted;
  }

  markRunWaiting(runId: number, waitNote: string, recurring: boolean) {
    this.db
      .prepare(
        `UPDATE task_runs
         SET status = 'waiting', durable = 1, recurring = ?, wait_note = ?, updated_at = datetime('now', 'localtime')
         WHERE id = ?`,
      )
      .run(recurring ? 1 : 0, waitNote || '', runId);
  }

  touchRun(runId: number) {
    this.db
      .prepare(`UPDATE task_runs SET updated_at = datetime('now', 'localtime') WHERE id = ?`)
      .run(runId);
  }

  listWaitingRuns(waromUserId: string): TaskRunRow[] {
    return this.db
      .prepare(
        `SELECT * FROM task_runs
         WHERE warom_user_id = ? AND status = 'waiting'
         ORDER BY updated_at ASC`,
      )
      .all(waromUserId) as unknown as TaskRunRow[];
  }
}
