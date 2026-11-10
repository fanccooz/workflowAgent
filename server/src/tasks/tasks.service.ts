import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService, TaskStepStatus } from '../database/database.service';
import { DeepseekService } from '../deepseek/deepseek.service';

@Injectable()
export class TasksService {
  constructor(
    private readonly db: DatabaseService,
    private readonly deepseek: DeepseekService,
  ) {}

  async plan(
    waromUserId: string,
    utterance: string,
    options?: {
      history?: Array<{ role?: string; content?: string }>;
      pageSummary?: Record<string, unknown>;
    },
  ) {
    const userId = String(waromUserId || '').trim();
    const text = String(utterance || '').trim();
    if (!userId) throw new BadRequestException('缺少 waromUserId');
    if (!text) throw new BadRequestException('缺少 utterance');

    let history = Array.isArray(options?.history) ? options!.history! : [];
    if (!history.length) {
      history = this.db.listRecentChatEvents(userId, 40).map((row) => ({
        role: row.role,
        content: row.content,
      }));
    }

    const planned = await this.deepseek.planTaskSteps(text, {
      history,
      pageSummary: options?.pageSummary,
    });
    const run = this.db.createTaskRun(userId, text, planned.reply);
    const steps = this.db.insertTaskSteps(
      run.id,
      planned.steps.map((step, index) => ({
        seq: index + 1,
        type: step.type,
        query: step.query,
      })),
    );
    // 对话记录只由 /api/events/chat（扩展面板 reportChat）写入，避免与 plan 重复各存一条

    return {
      runId: run.id,
      reply: planned.reply,
      status: run.status,
      steps: steps.map((step) => ({
        seq: step.seq,
        type: step.type,
        query: step.query,
        status: step.status,
      })),
    };
  }

  /** 把扩展已经拆好的步骤原样入库，不再另叫一次模型。 */
  save(
    waromUserId: string,
    utterance: string,
    reply: string,
    rawSteps: unknown,
    options?: { durable?: boolean; recurring?: boolean; waitNote?: string },
  ) {
    const userId = String(waromUserId || '').trim();
    const text = String(utterance || '').trim();
    if (!userId) throw new BadRequestException('缺少 waromUserId');
    if (!text) throw new BadRequestException('缺少 utterance');
    const accepted = this.deepseek.acceptSteps(rawSteps);
    if (!accepted.length) throw new BadRequestException('没有可入库的步骤');
    const run = this.db.createTaskRun(userId, text, String(reply || ''));
    const steps = this.db.insertTaskSteps(
      run.id,
      accepted.map((step, index) => ({
        seq: index + 1,
        type: step.type,
        query: step.query,
      })),
    );
    if (options?.durable) {
      this.db.markRunWaiting(run.id, String(options.waitNote || ''), Boolean(options.recurring));
    }
    const stored = this.db.getTaskRun(run.id);
    return {
      runId: run.id,
      reply: run.reply,
      status: stored?.status || run.status,
      steps: steps.map((step) => ({
        seq: step.seq,
        type: step.type,
        query: step.query,
        status: step.status,
      })),
    };
  }

  listWaiting(waromUserId: string) {
    const userId = String(waromUserId || '').trim();
    if (!userId) throw new BadRequestException('缺少 waromUserId');
    const runs = this.db.listWaitingRuns(userId);
    return {
      tasks: runs.map((run) => ({
        runId: run.id,
        utterance: run.utterance,
        reply: run.reply,
        status: run.status,
        recurring: Boolean(run.recurring),
        waitNote: run.wait_note || '',
        updatedAt: run.updated_at,
        steps: this.db.listTaskSteps(run.id).map((step) => ({
          seq: step.seq,
          type: step.type,
          query: step.query,
          status: step.status,
        })),
      })),
    };
  }

  finishRun(runId: number) {
    const run = this.db.getTaskRun(runId);
    if (!run) throw new NotFoundException('任务不存在');
    this.db.updateTaskRunStatus(runId, 'done');
    return { ok: true, runId, status: 'done' };
  }

  touchRun(runId: number) {
    const run = this.db.getTaskRun(runId);
    if (!run) throw new NotFoundException('任务不存在');
    this.db.touchRun(runId);
    return { ok: true, runId, status: run.status };
  }

  getRun(runId: number) {
    const run = this.db.getTaskRun(runId);
    if (!run) throw new NotFoundException('任务不存在');
    const steps = this.db.listTaskSteps(runId);
    return {
      runId: run.id,
      waromUserId: run.warom_user_id,
      utterance: run.utterance,
      reply: run.reply,
      status: run.status,
      steps: steps.map((step) => ({
        seq: step.seq,
        type: step.type,
        query: step.query,
        status: step.status,
        resultMessage: step.result_message,
      })),
    };
  }

  markRunning(runId: number) {
    const run = this.db.getTaskRun(runId);
    if (!run) throw new NotFoundException('任务不存在');
    this.db.updateTaskRunStatus(runId, 'running');
    return { ok: true, runId, status: 'running' };
  }

  patchStep(
    runId: number,
    seq: number,
    body: { status?: string; resultMessage?: string; finalizeRun?: boolean },
  ) {
    const run = this.db.getTaskRun(runId);
    if (!run) throw new NotFoundException('任务不存在');
    const allowed: TaskStepStatus[] = ['pending', 'running', 'done', 'failed', 'skipped'];
    const status = String(body?.status || 'done') as TaskStepStatus;
    if (!allowed.includes(status)) throw new BadRequestException('非法 status');
    const row = this.db.updateTaskStep(runId, seq, status, String(body?.resultMessage || ''));
    if (!row) throw new NotFoundException('步骤不存在');

    if (body?.finalizeRun) {
      const steps = this.db.listTaskSteps(runId);
      const pending = steps.some((item) => item.status === 'pending' || item.status === 'running');
      const failed = steps.some((item) => item.status === 'failed');
      this.db.updateTaskRunStatus(runId, pending ? 'running' : failed ? 'failed' : 'done');
    }

    return {
      ok: true,
      step: {
        seq: row.seq,
        type: row.type,
        query: row.query,
        status: row.status,
        resultMessage: row.result_message,
      },
    };
  }

  async act(
    runId: number,
    seq: number,
    body: {
      lastError?: string;
      pageSummary?: Record<string, unknown>;
      history?: Array<{ role?: string; content?: string }>;
    },
  ) {
    const run = this.db.getTaskRun(runId);
    if (!run) throw new NotFoundException('任务不存在');
    const steps = this.db.listTaskSteps(runId);
    const step = steps.find((item) => item.seq === seq);
    if (!step) throw new NotFoundException('步骤不存在');

    let history = Array.isArray(body?.history) ? body.history : [];
    if (!history.length) {
      history = this.db.listRecentChatEvents(run.warom_user_id, 20).map((row) => ({
        role: row.role,
        content: row.content,
      }));
    }

    const advice = await this.deepseek.actOnStepFailure({
      utterance: run.utterance,
      step: { type: step.type, query: step.query, seq: step.seq },
      lastError: String(body?.lastError || step.result_message || ''),
      pageSummary: body?.pageSummary || {},
      history,
    });
    return advice;
  }

  /** 失败后换掉后续步骤。优先采用扩展已校验的 steps，否则再问模型。 */
  async replan(
    runId: number,
    body: {
      failedSeq?: number;
      lastError?: string;
      pageSummary?: Record<string, unknown>;
      history?: Array<{ role?: string; content?: string }>;
      steps?: unknown;
    },
  ) {
    const run = this.db.getTaskRun(runId);
    if (!run) throw new NotFoundException('任务不存在');
    const existing = this.db.listTaskSteps(runId);
    const failedSeq = Number(body?.failedSeq || 0);
    const failed = existing.find((item) => item.seq === failedSeq);
    let reply = '';
    let next = this.deepseek.acceptSteps(body?.steps);
    if (!next.length) {
      const planned = await this.deepseek.replanRemaining({
        utterance: run.utterance,
        failedStep: failed
          ? { type: failed.type, query: failed.query, seq: failed.seq }
          : { seq: failedSeq },
        lastError: String(body?.lastError || ''),
        pageSummary: body?.pageSummary || {},
        history: body?.history,
        doneSteps: existing
          .filter((item) => item.status === 'done')
          .map((item) => ({ type: item.type, query: item.query })),
      });
      reply = planned.reply;
      next = planned.steps;
    }
    const inserted = this.db.replacePendingTail(runId, failedSeq, next);
    return {
      ok: true,
      runId,
      reply,
      steps: inserted.map((step) => ({
        seq: step.seq,
        type: step.type,
        query: step.query,
        status: step.status,
      })),
    };
  }
}
