import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
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

  @Get(':runId')
  get(@Param('runId') runId: string) {
    return this.tasks.getRun(Number(runId));
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
}
