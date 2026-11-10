import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { DeepseekService } from '../deepseek/deepseek.service';

@Injectable()
export class SuggestionsService {
  private readonly logger = new Logger(SuggestionsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly deepseek: DeepseekService,
  ) {}

  async getChatBoxSuggestion(waromUserId: string, refresh = false) {
    const userId = String(waromUserId || '').trim();
    if (!userId) throw new BadRequestException('缺少 waromUserId');

    const minMessages = Number(process.env.MIN_USER_MESSAGES || 3);
    const recentLimit = Number(process.env.RECENT_LIMIT || 30);
    const latestId = this.db.latestUserEventId(userId);
    const cachedRows = this.db.listSuggestions(userId);
    const cached = cachedRows.map((row) => row.suggestion).filter(Boolean);
    const cacheFresh = cached.length === 3
      && new Set(cached).size === 3
      && cachedRows.every((row) => row.based_on_event_id != null && Number(row.based_on_event_id) === Number(latestId));

    if (!refresh && cacheFresh) {
      return {
        suggestions: cached,
        suggestion: cached[0],
        source: 'deepseek',
        cached: true,
      };
    }

    const recent = this.db.listRecentUserMessages(userId, recentLimit);
    if (recent.length < minMessages) {
      return { suggestions: [], suggestion: '', source: 'none', cached: false };
    }

    try {
      const messages = recent.map((row) => row.content);
      let suggestions = await this.deepseek.generateChatBoxSuggestions(messages, cached);
      const unchanged = suggestions.length === cached.length
        && suggestions.every((text, index) => text === cached[index]);
      if (unchanged) {
        suggestions = await this.deepseek.generateChatBoxSuggestions(messages, cached);
      }
      const stillSame = suggestions.length > 0
        && suggestions.length === cached.length
        && suggestions.every((text, index) => text === cached[index]);
      // 和已存内容完全一样时不写库
      if (suggestions.length === 3 && !stillSame) {
        this.db.replaceSuggestions(userId, suggestions, latestId);
      }
      const visible = suggestions.length ? suggestions : cached;
      return {
        suggestions: visible,
        suggestion: visible[0] || '',
        source: visible.length ? 'deepseek' : 'none',
        cached: false,
        message: visible.length ? undefined : 'DeepSeek 未生成可用建议语',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : '生成失败';
      this.logger.error(message);
      return { suggestions: [], suggestion: '', source: 'error', cached: false, message };
    }
  }
}
