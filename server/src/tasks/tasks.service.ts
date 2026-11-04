import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService, TaskStepStatus } from '../database/database.service';
import { DeepseekService } from '../deepseek/deepseek.service';

@Injectable()
export class TasksService {
  constructor(
    private readonly db: DatabaseService,
    private readonly deepseek: DeepseekService,
  ) {}

  async plan(waromUserId: string, utterance: string) {
    const userId = String(waromUserId || '').trim();
    const text = String(utterance || '').trim();
    if (!userId) throw new BadRequestException('缺少 waromUserId');
    if (!text) throw new BadRequestException('缺少 utterance');

    const planned = await this.deepseek.planTaskSteps(text);
    const run = this.db.createTaskRun(userId, text, planned.reply);
    const steps = this.db.insertTaskSteps(
      run.id,
      planned.steps.map((step, index) => ({
        seq: index + 1,
        type: step.type,
        query: step.query,
      })),
    );
    this.db.insertChatEvent(userId, 'user', text);
    if (planned.reply) this.db.insertChatEvent(userId, 'assistant', planned.reply);

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
      const failed = steps.some((item) => item.status === 'failed');
      const pending = steps.some((item) => item.status === 'pending' || item.status === 'running');
      this.db.updateTaskRunStatus(runId, failed ? 'failed' : pending ? 'running' : 'done');
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
    body: { lastError?: string; pageSummary?: Record<string, unknown> },
  ) {
    const run = this.db.getTaskRun(runId);
    if (!run) throw new NotFoundException('任务不存在');
    const steps = this.db.listTaskSteps(runId);
    const step = steps.find((item) => item.seq === seq);
    if (!step) throw new NotFoundException('步骤不存在');

    const advice = await this.deepseek.actOnStepFailure({
      utterance: run.utterance,
      step: { type: step.type, query: step.query, seq: step.seq },
      lastError: String(body?.lastError || step.result_message || ''),
      pageSummary: body?.pageSummary || {},
    });
    return advice;
  }
}
