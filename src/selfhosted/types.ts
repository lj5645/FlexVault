export interface DatabaseConfig {
  path: string;
}

export interface StorageConfig {
  path: string;
  maxFileSize: number;
}

export interface WebSocketConfig {
  port: number;
  path: string;
}

export interface ServerConfig {
  port: number;
  host: string;
}
