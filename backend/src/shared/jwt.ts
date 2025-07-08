// Minimal JWT utilities for Cloudflare Workers
import { JWTPayload } from './types';

// Simple JWT implementation using Web Crypto API
export class JWT {
  private secret: string;

  constructor(secret: string) {
    this.secret = secret;
  }

  async sign(payload: Omit<JWTPayload, 'iat' | 'exp'>): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const fullPayload: JWTPayload = {
      ...payload,
      iat: now,
      exp: now + (30 * 24 * 60 * 60), // 30 days
    };

    const header = { alg: 'HS256', typ: 'JWT' };
    
    const encodedHeader = this.base64UrlEncode(JSON.stringify(header));
    const encodedPayload = this.base64UrlEncode(JSON.stringify(fullPayload));
    
    const signature = await this.sign256(`${encodedHeader}.${encodedPayload}`);
    
    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  async verify(token: string): Promise<JWTPayload | null> {
    try {
      const [header, payload, signature] = token.split('.');
      
      // Verify signature
      const expectedSignature = await this.sign256(`${header}.${payload}`);
      if (signature !== expectedSignature) {
        return null;
      }

      const decodedPayload = JSON.parse(this.base64UrlDecode(payload)) as JWTPayload;
      
      // Check expiration
      if (decodedPayload.exp < Math.floor(Date.now() / 1000)) {
        return null;
      }

      return decodedPayload;
    } catch {
      return null;
    }
  }

  private async sign256(data: string): Promise<string> {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(this.secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
    return this.base64UrlEncode(new Uint8Array(signature));
  }

  private base64UrlEncode(data: string | Uint8Array): string {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    return btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  private base64UrlDecode(data: string): string {
    const padded = data + '='.repeat((4 - data.length % 4) % 4);
    const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
    return atob(base64);
  }
}
