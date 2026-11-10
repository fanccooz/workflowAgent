import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ExtensionTokenGuard } from '../auth/extension-token.guard';
import { SuggestionsService } from './suggestions.service';

@Controller('suggestions')
@UseGuards(ExtensionTokenGuard)
export class SuggestionsController {
  constructor(private readonly suggestions: SuggestionsService) {}

  @Get('chat-box')
  chatBox(
    @Query('waromUserId') waromUserId: string,
    @Query('refresh') refresh?: string,
  ) {
    return this.suggestions.getChatBoxSuggestion(
      waromUserId,
      refresh === '1' || refresh === 'true',
    );
  }

  @Post('remove')
  remove(@Body() body: { waromUserId?: string; id?: number }) {
    return this.suggestions.removeChatBoxSuggestion(
      String(body?.waromUserId || ''),
      Number(body?.id),
    );
  }

  @Post('clear')
  clear(@Body() body: { waromUserId?: string }) {
    return this.suggestions.clearChatBoxSuggestions(String(body?.waromUserId || ''));
  }
}
