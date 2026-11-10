export interface LokiQueryInput {
  logql: string;
  start: string;
  end: string;
  limit?: number;
}

export interface LogsQueryResult {
  rawBytes: number;
  lines: string[];
}

export interface LogsPort {
  queryLogs(input: LokiQueryInput): Promise<LogsQueryResult>;
}
