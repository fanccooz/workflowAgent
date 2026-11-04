import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class DeepseekService {
  private readonly logger = new Logger(DeepseekService.name);

  async generateChatBoxSuggestion(userMessages: string[]): Promise<string> {
    const apiKey = process.env.DEEPSEEK_API_KEY || '';
    if (!apiKey) {
      this.logger.warn('DEEPSEEK_API_KEY 未配置，无法生成建议语');
      throw new Error('服务器未配置 DEEPSEEK_API_KEY，请编辑 server/.env 后重启 Nest');
    }
    const base = String(process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
    const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

    const system = [
      '你根据用户最近在华荣流程助手里的输入，归纳一句「下一次最可能直接键入」的中文短句。',
      '要求：只输出这一句话本身，不要引号、不要 Markdown、不要解释。',
      '句子要可直接粘贴进输入框发送（例如：帮我请假，明天到后天，事由开会）。',
      '若记录太杂或无法归纳，只输出空字符串。',
    ].join('');

    const recent = userMessages.slice(0, 30).map((text, i) => `${i + 1}. ${text}`).join('\n');
    const response = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `最近用户输入：\n${recent}` },
        ],
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      error?: { message?: string };
      choices?: Array<{ message?: { content?: string } }>;
    };
    if (!response.ok) {
      throw new Error(payload.error?.message || `DeepSeek 请求失败（${response.status}）`);
    }
    const content = payload.choices?.[0]?.message?.content || '';
    return String(content).trim().replace(/^["「]|["」]$/g, '');
  }
}
