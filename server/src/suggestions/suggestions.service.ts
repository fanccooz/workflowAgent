import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { DeepseekService } from '../deepseek/deepseek.service';

@Injectable()
export class SuggestionsService {
  private readonly logger = new Logger(SuggestionsService.name);
  /** 超过这个时间就重新生成，避免同一句一直留在库里。 */
  private static readonly TTL_MS = 5 * 60 * 1000;

  private present(rows: Array<{ id: number; warom_user_id: string; content: string; updated_at: string; based_on_event_id: number | null }>) {
    const suggestions = rows.map((row) => ({
      id: row.id,
      waromUserId: row.warom_user_id,
      content: row.content,
      updatedAt: row.updated_at,
      basedOnEventId: row.based_on_event_id,
    }));
    return {
      suggestions,
      suggestion: suggestions[0]?.content || '',
    };
  }

  private rowAgeMs(updatedAt: string) {
    const parsed = Date.parse(String(updatedAt || '').replace(' ', 'T'));
    if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY;
    return Date.now() - parsed;
  }

  constructor(
    private readonly db: DatabaseService,
    private readonly deepseek: DeepseekService,
  ) {}

  private static readonly SCHEMA_LOCKED = '建议表被数据库工具占用，请先关掉 DB Browser，再刷新快捷建议。';

  private readySchema() {
    try {
      this.db.ensureSuggestionSchema();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : '建议表暂时不可用';
      if (/locked/i.test(message)) return false;
      throw new ServiceUnavailableException(message);
    }
  }

  async getChatBoxSuggestion(waromUserId: string, refresh = false) {
    const userId = String(waromUserId || '').trim();
    if (!userId) throw new BadRequestException('缺少 waromUserId');
    if (!this.readySchema()) {
      const legacy = this.present(this.db.listLegacySuggestions(userId));
      return { ...legacy, source: 'error', cached: true, message: SuggestionsService.SCHEMA_LOCKED };
    }

    const minMessages = Number(process.env.MIN_USER_MESSAGES || 3);
    const recentLimit = Number(process.env.RECENT_LIMIT || 30);
    const latestId = this.db.latestUserEventId(userId);
    const cachedRows = this.db.listSuggestions(userId);
    const cached = cachedRows.map((row) => row.content).filter(Boolean);
    const stale = cachedRows.length === 0 || cachedRows.some((row) => this.rowAgeMs(row.updated_at) > SuggestionsService.TTL_MS);
    const cacheFresh = !stale
      && cached.length > 0
      && new Set(cached).size === cached.length
      && cachedRows.every((row) => row.based_on_event_id != null && Number(row.based_on_event_id) === Number(latestId));

    if (!refresh && cacheFresh) {
      return { ...this.present(cachedRows), source: 'deepseek', cached: true };
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
      const visibleRows = this.db.listSuggestions(userId);
      const presented = this.present(visibleRows);
      return {
        ...presented,
        source: presented.suggestions.length ? 'deepseek' : 'none',
        cached: false,
        message: presented.suggestions.length ? undefined : 'DeepSeek 未生成可用建议语',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : '生成失败';
      this.logger.error(message);
      if (cachedRows.length) {
        return { ...this.present(cachedRows), source: 'error', cached: true, message };
      }
      return { suggestions: [], suggestion: '', source: 'error', cached: false, message };
    }
  }

  removeChatBoxSuggestion(waromUserId: string, id: number) {
    const userId = String(waromUserId || '').trim();
    const suggestionId = Number(id);
    if (!userId) throw new BadRequestException('缺少 waromUserId');
    if (!this.readySchema()) throw new ServiceUnavailableException(SuggestionsService.SCHEMA_LOCKED);
    if (!Number.isInteger(suggestionId) || suggestionId <= 0) {
      throw new BadRequestException('缺少 id');
    }
    let rows;
    try {
      rows = this.db.deleteSuggestionById(userId, suggestionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : '删除失败';
      throw new ServiceUnavailableException(message);
    }
    return { ok: true, ...this.present(rows) };
  }

  clearChatBoxSuggestions(waromUserId: string) {
    const userId = String(waromUserId || '').trim();
    if (!userId) throw new BadRequestException('缺少 waromUserId');
    if (!this.readySchema()) throw new ServiceUnavailableException(SuggestionsService.SCHEMA_LOCKED);
    try {
      this.db.clearSuggestions(userId);
    } catch (error) {
      const message = error instanceof Error ? error.message : '删除失败';
      throw new ServiceUnavailableException(message);
    }
    return { ok: true, suggestions: [], suggestion: '' };
  }
}
