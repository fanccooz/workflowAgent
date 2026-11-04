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
    const cache = this.db.getSuggestionCache(userId);

    if (
      !refresh
      && cache
      && cache.suggestion
      && cache.based_on_event_id != null
      && latestId != null
      && Number(cache.based_on_event_id) === Number(latestId)
    ) {
      return {
        suggestion: cache.suggestion,
        source: 'deepseek',
        cached: true,
      };
    }

    const recent = this.db.listRecentUserMessages(userId, recentLimit);
    if (recent.length < minMessages) {
      return { suggestion: '', source: 'none', cached: false };
    }

    try {
      const suggestion = await this.deepseek.generateChatBoxSuggestion(
        recent.map((row) => row.content),
      );
      // 只有真正生成出句子才写入缓存，避免空结果锁住后续拉取
      if (suggestion) {
        this.db.upsertSuggestion(userId, suggestion, latestId);
      }
      return {
        suggestion,
        source: suggestion ? 'deepseek' : 'none',
        cached: false,
        message: suggestion ? undefined : 'DeepSeek 未生成可用建议语',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : '生成失败';
      this.logger.error(message);
      return { suggestion: '', source: 'error', cached: false, message };
    }
  }
}
