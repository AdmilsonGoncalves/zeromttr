import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const NGINX_TEMPLATE_PATH = path.resolve(import.meta.dirname, '../../nginx.conf.template');

describe('nginx.conf.template proxy & rate-limit IP restoration', () => {
  it('should restore the real visitor address from trusted proxy X-Forwarded-For headers while sanitizing upstream headers', () => {
    const content = fs.readFileSync(NGINX_TEMPLATE_PATH, 'utf8');

    expect(content).toContain('real_ip_header X-Forwarded-For;');
    expect(content).toContain('real_ip_recursive on;');
    expect(content).toContain('set_real_ip_from 10.0.0.0/8;');
    expect(content).toContain('set_real_ip_from 172.16.0.0/12;');
    expect(content).toContain('set_real_ip_from 192.168.0.0/16;');
    expect(content).toContain('set_real_ip_from 127.0.0.1;');
    expect(content).toContain('set_real_ip_from ::1;');
    expect(content).toContain('set_real_ip_from fc00::/7;');

    // Sanitize forwarding headers sent to orchestrator using the restored $remote_addr
    expect(content).toContain('proxy_set_header X-Real-IP $remote_addr;');
    expect(content).toContain('proxy_set_header X-Forwarded-For $remote_addr;');
    expect(content).toContain('proxy_set_header Authorization "Bearer ${DASHBOARD_API_TOKEN}";');
    expect(content).toContain("sub_filter '__ZEROMTTR_DOCS_DOMAIN__' '${ZEROMTTR_DOCS_DOMAIN}';");
  });
});
