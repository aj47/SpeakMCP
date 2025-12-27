import type { ClientConfig } from './types.js'

export class HttpClient {
  private baseUrl: string
  private apiKey?: string
  private timeout: number
  private onAuthError?: () => void
  private onError?: (error: Error) => void

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '')
    this.apiKey = config.apiKey
    this.timeout = config.timeout ?? 30000
    this.onAuthError = config.onAuthError
    this.onError = config.onError
  }

  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    }
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`
    }
    return headers
  }

  async request<T>(
    method: string,
    path: string,
    options: {
      body?: unknown
      query?: Record<string, string | number | boolean | undefined>
      headers?: HeadersInit
      timeout?: number
    } = {}
  ): Promise<T> {
    let url = `${this.baseUrl}${path}`

    // Add query parameters
    if (options.query) {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined) {
          params.append(key, String(value))
        }
      }
      const queryString = params.toString()
      if (queryString) {
        url += `?${queryString}`
      }
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(
      () => controller.abort(),
      options.timeout ?? this.timeout
    )

    try {
      const response = await fetch(url, {
        method,
        headers: { ...this.getHeaders(), ...options.headers },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        if (response.status === 401) {
          this.onAuthError?.()
        }
        
        const errorBody = await response.json().catch(() => ({}))
        const error = new Error(errorBody.error ?? `HTTP ${response.status}`)
        ;(error as any).status = response.status
        ;(error as any).code = errorBody.code
        this.onError?.(error)
        throw error
      }

      // Handle empty responses
      const text = await response.text()
      if (!text) return undefined as T

      return JSON.parse(text) as T
    } catch (error) {
      clearTimeout(timeoutId)
      
      if (error instanceof Error && error.name === 'AbortError') {
        const timeoutError = new Error('Request timeout')
        this.onError?.(timeoutError)
        throw timeoutError
      }
      
      throw error
    }
  }

  async get<T>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>('GET', path, { query })
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, { body })
  }

  async patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, { body })
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, { body })
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path)
  }

  // For SSE streaming
  async *stream<T>(
    method: string,
    path: string,
    body?: unknown
  ): AsyncGenerator<T> {
    const url = `${this.baseUrl}${path}`

    const response = await fetch(url, {
      method,
      headers: this.getHeaders(),
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      if (response.status === 401) {
        this.onAuthError?.()
      }
      const errorBody = await response.json().catch(() => ({}))
      throw new Error(errorBody.error ?? `HTTP ${response.status}`)
    }

    if (!response.body) {
      throw new Error('No response body')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') return
            try {
              yield JSON.parse(data) as T
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  // For file uploads
  async uploadFile<T>(
    path: string,
    file: Blob | File,
    filename: string,
    additionalFields?: Record<string, string>
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const formData = new FormData()
    formData.append('file', file, filename)

    if (additionalFields) {
      for (const [key, value] of Object.entries(additionalFields)) {
        formData.append(key, value)
      }
    }

    const headers: HeadersInit = {}
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`
    }
    // Don't set Content-Type for FormData - browser sets it with boundary

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: formData,
    })

    if (!response.ok) {
      if (response.status === 401) {
        this.onAuthError?.()
      }
      const errorBody = await response.json().catch(() => ({}))
      throw new Error(errorBody.error ?? `HTTP ${response.status}`)
    }

    return response.json()
  }

  // For binary downloads
  async downloadBlob(path: string, body?: unknown): Promise<Blob> {
    const url = `${this.baseUrl}${path}`

    const response = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: this.getHeaders(),
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      if (response.status === 401) {
        this.onAuthError?.()
      }
      throw new Error(`HTTP ${response.status}`)
    }

    return response.blob()
  }
}
