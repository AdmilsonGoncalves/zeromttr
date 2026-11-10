import type { LogsPort, LokiQueryInput } from '../ports/index.js';
import { LogTruncator, FinOpsCalculator, type FinOpsMetrics } from '../domain/index.js';
import { validateTimeRange } from './validate-time-range.js';

export interface QueryLokiLogsOutput {
  logql: string;
  lines_count: number;
  lines: string[];
  finops: FinOpsMetrics;
}

export class QueryLokiLogs {
  constructor(private readonly logsPort: LogsPort) {}

  async execute(input: LokiQueryInput): Promise<QueryLokiLogsOutput> {
    const { startIso, endIso } = validateTimeRange(input.start, input.end);

    const safeLimit = Math.min(100, Math.max(1, input.limit ?? 50));
    const result = await this.logsPort.queryLogs({
      ...input,
      start: startIso,
      end: endIso,
      limit: safeLimit
    });

    const lines = LogTruncator.truncateLines(result.lines, safeLimit, 500);
    const compactedBytes = Buffer.byteLength(JSON.stringify(lines), 'utf-8');
    const finops = FinOpsCalculator.calculate(result.rawBytes, compactedBytes);

    return {
      logql: input.logql,
      lines_count: lines.length,
      lines,
      finops
    };
  }
}
