import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ExtensionTokenGuard } from '../auth/extension-token.guard';
import { EventsService } from './events.service';

@Controller('events')
@UseGuards(ExtensionTokenGuard)
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Post('chat')
  createChat(
    @Body()
    body: {
      waromUserId?: string;
      content?: string;
      role?: 'user' | 'assistant';
    },
  ) {
    const row = this.events.addChatEvent(
      String(body?.waromUserId || ''),
      String(body?.content || ''),
      body?.role === 'assistant' ? 'assistant' : 'user',
    );
    return { ok: true, id: row.id };
  }
}
