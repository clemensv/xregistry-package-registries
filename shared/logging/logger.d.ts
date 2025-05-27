/**
 * TypeScript declarations for Enhanced xRegistry Logging Library
 */

export interface LoggerOptions {
  serviceName?: string;
  serviceVersion?: string;
  environment?: string;
  enableConsole?: boolean;
  enableFile?: boolean;
  logFile?: string;
  enableW3CLog?: boolean;
  w3cLogFile?: string;
  w3cLogToStdout?: boolean;
  context?: LogData;
}

export interface LogData {
  [key: string]: any;
}

export interface XRegistryLogger {
  debug(message: string, data?: LogData, req?: any): void;
  info(message: string, data?: LogData, req?: any): void;
  warn(message: string, data?: LogData, req?: any): void;
  error(message: string, data?: LogData, req?: any): void;
  fatal(message: string, data?: LogData, req?: any): void;
  
  logRequest(req: any, res: any, duration: number): void;
  logStartup(port: number | string, additionalInfo?: LogData): void;
  logShutdown(signal: string, additionalInfo?: LogData): void;
  logHealthCheck(status: string, checks?: LogData): void;
  logDependency(name: string, url: string, duration: number, success: boolean, error?: Error | null): void;
  
  middleware(): (req: any, res: any, next: any) => void;
  setRequestContext(req: any, res: any, next: any): void;
  child(additionalContext?: LogData): XRegistryLogger;
  close(): Promise<void>;
  
  // Enhanced logging methods
  sanitizeHeaders(headers: any): any;
  writeW3CLogEntry(req: any, res: any, duration: number): void;
  writeW3CHeader(toStdout?: boolean): void;
  initializeW3CLogging(): void;
  initializeFileLogging(): void;
}

export declare const LOG_LEVELS: {
  debug: number;
  info: number;
  warn: number;
  error: number;
  fatal: number;
};

export declare function createLogger(options?: LoggerOptions): XRegistryLogger;
export declare function createRequestMiddleware(logger: XRegistryLogger): (req: any, res: any, next: any) => void;

export { XRegistryLogger as default }; 