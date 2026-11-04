import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { DeepseekModule } from './deepseek/deepseek.module';
import { EventsModule } from './events/events.module';
import { SuggestionsModule } from './suggestions/suggestions.module';
import { TasksModule } from './tasks/tasks.module';

@Module({
  imports: [DatabaseModule, DeepseekModule, EventsModule, SuggestionsModule, TasksModule],
})
export class AppModule {}
