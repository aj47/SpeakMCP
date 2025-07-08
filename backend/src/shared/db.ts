// Minimal database utilities for Cloudflare D1
import { User, Usage, Env, QUOTAS } from './types';

export class Database {
  private db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async getUser(id: string): Promise<User | null> {
    console.log('getUser called with id:', id);

    if (!id) {
      console.error('getUser called with undefined/null id');
      throw new Error('User ID is required');
    }

    const result = await this.db.prepare(
      'SELECT * FROM users WHERE id = ?'
    ).bind(id).first<User>();

    console.log('getUser result:', result);
    return result || null;
  }

  async createUser(user: Omit<User, 'created_at' | 'updated_at'>): Promise<User> {
    const now = Math.floor(Date.now() / 1000);

    await this.db.prepare(`
      INSERT INTO users (id, email, name, avatar_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      user.id,
      user.email,
      user.name || null,
      user.avatar_url || null,
      now,
      now
    ).run();

    return {
      ...user,
      created_at: now,
      updated_at: now,
    };
  }

  async updateUser(id: string, updates: Partial<Pick<User, 'name' | 'avatar_url'>>): Promise<void> {
    const now = Math.floor(Date.now() / 1000);

    await this.db.prepare(`
      UPDATE users
      SET name = COALESCE(?, name),
          avatar_url = COALESCE(?, avatar_url),
          updated_at = ?
      WHERE id = ?
    `).bind(
      updates.name || null,
      updates.avatar_url || null,
      now,
      id
    ).run();
  }

  async getUsage(userId: string, month: string): Promise<Usage> {
    const result = await this.db.prepare(
      'SELECT * FROM usage WHERE user_id = ? AND month = ?'
    ).bind(userId, month).first<Usage>();

    return result || {
      user_id: userId,
      month,
      stt_seconds: 0,
      chat_tokens: 0,
    };
  }

  async addUsage(userId: string, sttSeconds: number = 0, chatTokens: number = 0): Promise<void> {
    const month = new Date().toISOString().slice(0, 7); // YYYY-MM

    await this.db.prepare(`
      INSERT INTO usage (user_id, month, stt_seconds, chat_tokens)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (user_id, month) DO UPDATE SET
        stt_seconds = stt_seconds + excluded.stt_seconds,
        chat_tokens = chat_tokens + excluded.chat_tokens
    `).bind(userId, month, sttSeconds, chatTokens).run();
  }

  async checkQuota(userId: string): Promise<{ canUseStt: boolean; canUseChat: boolean }> {
    const month = new Date().toISOString().slice(0, 7);
    const usage = await this.getUsage(userId, month);

    return {
      canUseStt: usage.stt_seconds < QUOTAS.FREE.stt_seconds,
      canUseChat: usage.chat_tokens < QUOTAS.FREE.chat_tokens,
    };
  }
}
