import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ExtensionTokenGuard } from '../auth/extension-token.guard';
import { TasksService } from './tasks.service';

@Controller('tasks')
@UseGuards(ExtensionTokenGuard)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Post('plan')
  plan(
    @Body()
    body: {
      waromUserId?: string;
      utterance?: string;
      history?: Array<{ role?: string; content?: string }>;
      pageSummary?: Record<string, unknown>;
    },
  ) {
    return this.tasks.plan(String(body?.waromUserId || ''), String(body?.utterance || ''), {
      history: body?.history,
      pageSummary: body?.pageSummary,
    });
  }

  @Post('save')
  save(
    @Body()
    body: {
      waromUserId?: string;
      utterance?: string;
      reply?: string;
      steps?: unknown;
      durable?: boolean;
      recurring?: boolean;
      waitNote?: string;
    },
  ) {
    return this.tasks.save(
      String(body?.waromUserId || ''),
      String(body?.utterance || ''),
      String(body?.reply || ''),
      body?.steps,
      {
        durable: Boolean(body?.durable),
        recurring: Boolean(body?.recurring),
        waitNote: String(body?.waitNote || ''),
      },
    );
  }

  @Get('waiting')
  waiting(@Query('waromUserId') waromUserId?: string) {
    return this.tasks.listWaiting(String(waromUserId || ''));
  }

  @Get(':runId')
  get(@Param('runId') runId: string) {
    return this.tasks.getRun(Number(runId));
  }

  @Post(':runId/finish')
  finish(@Param('runId') runId: string) {
    return this.tasks.finishRun(Number(runId));
  }

  @Post(':runId/touch')
  touch(@Param('runId') runId: string) {
    return this.tasks.touchRun(Number(runId));
  }

  @Post(':runId/start')
  start(@Param('runId') runId: string) {
    return this.tasks.markRunning(Number(runId));
  }

  @Patch(':runId/steps/:seq')
  patchStep(
    @Param('runId') runId: string,
    @Param('seq') seq: string,
    @Body()
    body: {
      status?: string;
      resultMessage?: string;
      finalizeRun?: boolean;
    },
  ) {
    return this.tasks.patchStep(Number(runId), Number(seq), body || {});
  }

  @Post(':runId/steps/:seq/act')
  act(
    @Param('runId') runId: string,
    @Param('seq') seq: string,
    @Body()
    body: {
      lastError?: string;
      pageSummary?: Record<string, unknown>;
      history?: Array<{ role?: string; content?: string }>;
    },
  ) {
    return this.tasks.act(Number(runId), Number(seq), body || {});
  }

  @Post(':runId/replan')
  replan(
    @Param('runId') runId: string,
    @Body()
    body: {
      failedSeq?: number;
      lastError?: string;
      pageSummary?: Record<string, unknown>;
      history?: Array<{ role?: string; content?: string }>;
      steps?: unknown;
    },
  ) {
    return this.tasks.replan(Number(runId), body || {});
  }
}
