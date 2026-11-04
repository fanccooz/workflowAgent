import { BadRequestException, Injectable } from '@nestjs/common';
import { ChatRole, DatabaseService } from '../database/database.service';

@Injectable()
export class EventsService {
  constructor(private readonly db: DatabaseService) {}

  addChatEvent(waromUserId: string, content: string, role: ChatRole = 'user') {
    const userId = String(waromUserId || '').trim();
    const text = String(content || '').trim();
    if (!userId) throw new BadRequestException('缺少 waromUserId');
    if (!text) throw new BadRequestException('缺少 content');
    if (role !== 'user' && role !== 'assistant') {
      throw new BadRequestException('role 无效');
    }
    return this.db.insertChatEvent(userId, role, text.slice(0, 2000));
  }
}
