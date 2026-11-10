import nock from 'nock';

export function setupNock() {
  nock.disableNetConnect();
  nock.enableNetConnect((host) => host.includes('127.0.0.1') || host.includes('localhost'));
}

export function cleanNock() {
  nock.cleanAll();
}

export function teardownNock() {
  nock.cleanAll();
  nock.enableNetConnect();
}

// 1. Prometheus mock
export function mockPrometheusQueryRange(
  baseUrl = 'http://localhost:9090',
  options: {
    status?: number;
    series?: Array<{ metric: Record<string, string>; values: [number, string][] }>;
  } = {}
) {
  const status = options.status ?? 200;
  const series = options.series ?? [
    {
      metric: { __name__: 'http_requests_total', job: 'api-pagamentos-core', status: '500' },
      values: [
        [1700000000, '5'],
        [1700000015, '12'],
        [1700000030, '45'],
        [1700000045, '80'],
        [1700000060, '150']
      ]
    }
  ];

  return nock(baseUrl)
    .get('/api/v1/query_range')
    .query(true)
    .reply(status, {
      status: status === 200 ? 'success' : 'error',
      data: {
        resultType: 'matrix',
        result: series
      }
    });
}

// 2. Loki mock
export function mockLokiQueryRange(
  baseUrl = 'http://localhost:3100',
  options: {
    status?: number;
    lines?: string[];
  } = {}
) {
  const status = options.status ?? 200;
  const rawLines = options.lines ?? [
    '[2026-11-09 10:15:00] ERROR: knex connection timeout acquiring client from pool',
    '[2026-11-09 10:15:01] WARN: payment request failed for customer [REDACTED_CPF]',
    '[2026-11-09 10:15:02] ERROR: Pool exhausted, waiting clients: 45'
  ];

  const streamValues = rawLines.map((line, idx) => [
    String(1700000000000000000 + idx * 1000000000),
    line
  ]);

  return nock(baseUrl)
    .get('/loki/api/v1/query_range')
    .query(true)
    .reply(status, {
      status: status === 200 ? 'success' : 'error',
      data: {
        resultType: 'streams',
        result: [
          {
            stream: { app: 'target-app-demo', env: 'production' },
            values: streamValues
          }
        ]
      }
    });
}

// 3. Tempo mock
export function mockTempoGetTrace(
  baseUrl = 'http://localhost:3200',
  traceId = '4bf92f3577b34da6a3ce929d0e0e4736',
  options: {
    status?: number;
    spans?: unknown[];
  } = {}
) {
  const status = options.status ?? 200;
  const batches = [
    {
      resource: {
        attributes: [{ key: 'service.name', value: { stringValue: 'api-pagamentos-core' } }]
      },
      scopeSpans: [
        {
          spans: options.spans ?? [
            {
              spanId: 'span-root-1',
              traceId,
              name: 'POST /api/payments',
              startTimeUnixNano: '1700000000000000000',
              endTimeUnixNano: '1700000002500000000',
              status: { code: 1 },
              attributes: [
                { key: 'http.method', value: { stringValue: 'POST' } },
                { key: 'http.status_code', value: { intValue: 200 } }
              ]
            },
            {
              spanId: 'span-db-err',
              parentSpanId: 'span-root-1',
              traceId,
              name: 'knex:acquireConnection',
              startTimeUnixNano: '1700000000100000000',
              endTimeUnixNano: '1700000005100000000',
              status: { code: 2, message: 'Pool timeout exceeded' },
              attributes: [
                { key: 'error', value: { boolValue: true } },
                { key: 'service.name', value: { stringValue: 'postgres-db' } },
                { key: 'db.system', value: { stringValue: 'postgresql' } }
              ]
            }
          ]
        }
      ]
    }
  ];

  return nock(baseUrl).get(`/api/traces/${traceId}`).reply(status, { batches });
}

export function mockTempoSearch(
  baseUrl = 'http://localhost:3200',
  options: {
    status?: number;
    traces?: unknown[];
  } = {}
) {
  const status = options.status ?? 200;
  const traces = options.traces ?? [
    {
      traceID: '4bf92f3577b34da6a3ce929d0e0e4736',
      rootServiceName: 'api-pagamentos-core',
      rootTraceName: 'POST /api/payments',
      durationMs: 5000
    }
  ];

  return nock(baseUrl).get('/api/search').query(true).reply(status, { traces });
}

// 4. GitHub mocks
export function mockGithubCompare(
  repo = 'AdmilsonGoncalves/zeromttr',
  baseRef = 'v2.14.7',
  headRef = 'v2.14.8',
  options: {
    status?: number;
    authorLogin?: string;
    commitMessage?: string;
    files?: unknown[];
  } = {}
) {
  const status = options.status ?? 200;
  const authorLogin = options.authorLogin ?? 'admilson-dev';
  const commitMessage =
    options.commitMessage ??
    'feat: increase pool acquire timeout\n\nCo-authored-by: SRE Lead <sre.lead@example.com>';

  const files = options.files ?? [
    {
      filename: 'apps/target-app-demo/src/repositories/payment.repository.ts',
      status: 'modified',
      additions: 15,
      deletions: 4,
      patch:
        '@@ -10,4 +10,15 @@\n-  client.release();\n+  // connection release accidentally omitted in finally\n+  console.log("simulated leak");'
    }
  ];

  return nock('https://api.github.com')
    .get(`/repos/${repo}/compare/${baseRef}...${headRef}`)
    .reply(status, {
      commits: [
        {
          author: { login: authorLogin },
          commit: {
            author: { name: 'Admilson Gonçalves', email: 'admilson@example.com' },
            message: commitMessage
          }
        }
      ],
      files
    });
}

export function mockGithubGetContents(
  repo = 'AdmilsonGoncalves/zeromttr',
  filePath = 'apps/target-app-demo/src/repositories/payment.repository.ts',
  ref = 'v2.14.8',
  options: {
    status?: number;
    sha?: string;
    content?: string;
  } = {}
) {
  const status = options.status ?? 200;
  const sha = options.sha ?? 'blob-sha-abc-123';
  const rawContent = options.content ?? 'export class PaymentRepository { async pay() {} }';
  const base64Content = Buffer.from(rawContent, 'utf-8').toString('base64');

  return nock('https://api.github.com')
    .get(`/repos/${repo}/contents/${filePath}`)
    .query((q) => !ref || q.ref === ref)
    .reply(status, {
      sha,
      content: base64Content,
      encoding: 'base64'
    });
}

export function mockGithubRemediationFlow(
  repo = 'AdmilsonGoncalves/zeromttr',
  incidentId = 'inc-456',
  baseBranch = 'release/target-v2.14.8'
) {
  const branchName = `hotfix/zeromttr-${incidentId}`;

  // 1. Check branch (returns 404 first)
  nock('https://api.github.com')
    .get(`/repos/${repo}/git/ref/heads/${branchName}`)
    .reply(404, { message: 'Not Found' });

  // 2. Get base branch head sha
  nock('https://api.github.com')
    .get(`/repos/${repo}/git/ref/heads/${baseBranch}`)
    .reply(200, { object: { sha: 'base-branch-head-sha' } });

  // 3. Create branch ref
  nock('https://api.github.com')
    .post(`/repos/${repo}/git/refs`, {
      ref: `refs/heads/${branchName}`,
      sha: 'base-branch-head-sha'
    })
    .reply(201, { ref: `refs/heads/${branchName}` });

  // 4. Get file on branch
  nock('https://api.github.com')
    .get(`/repos/${repo}/contents/apps/target-app-demo/src/repositories/payment.repository.ts`)
    .query({ ref: branchName })
    .reply(200, { sha: 'blob-sha-on-branch' });

  // 5. Commit fix via PUT contents
  nock('https://api.github.com')
    .put(`/repos/${repo}/contents/apps/target-app-demo/src/repositories/payment.repository.ts`)
    .reply(200, {
      commit: { sha: 'commit-sha-hotfix-789' }
    });

  // 6. Check existing PR
  const owner = repo.split('/')[0];
  nock('https://api.github.com')
    .get(`/repos/${repo}/pulls`)
    .query({
      head: `${owner}:${branchName}`,
      base: baseBranch,
      state: 'open'
    })
    .reply(200, []);

  // 7. Create PR
  nock('https://api.github.com')
    .post(`/repos/${repo}/pulls`)
    .reply(201, {
      html_url: `https://github.com/${repo}/pull/99`
    });
}

// 5. Resend mock
export function mockResendSendEmail(
  options: {
    status?: number;
    emailId?: string;
  } = {}
) {
  const status = options.status ?? 200;
  const id = options.emailId ?? 'resend-email-msg-456';

  return nock('https://api.resend.com').post('/emails').reply(status, { id });
}

// 6. Grafana mock
export function mockGrafanaAnnotation(
  baseUrl = 'http://localhost:3000',
  options: {
    status?: number;
    annotationId?: number;
  } = {}
) {
  const status = options.status ?? 200;
  const id = options.annotationId ?? 88;

  return nock(baseUrl).post('/api/annotations').reply(status, { id, message: 'Annotation added' });
}
