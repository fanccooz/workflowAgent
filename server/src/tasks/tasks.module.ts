import { Module } from '@nestjs/common';
import { DeepseekModule } from '../deepseek/deepseek.module';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [DeepseekModule],
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
