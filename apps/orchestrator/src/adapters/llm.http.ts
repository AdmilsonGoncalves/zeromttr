import { isNonEmptyString, safeJsonParse, truncate } from '@zeromttr/utils';
import {
  CONTENT_TYPE,
  HTTP_HEADERS,
  buildUrl,
  isHttpSuccess,
  safeHttpUrl,
  trimTrailingSlash
} from '@zeromttr/utils/http';

/**
 * Resolves an HTTP(S) provider endpoint by checking the parsed URL pathname
 * (preserving query strings) before appending the expected suffix path.
 */
export function resolveProviderEndpoint(rawBaseUrl: string, suffixPath: string): string {
  const safeBase = safeHttpUrl(rawBaseUrl, '');
  if (!isNonEmptyString(safeBase)) {
    throw new Error(`Invalid LLM_BASE_URL '${rawBaseUrl}': must be a valid HTTP(S) URL`);
  }

  const parsed = new URL(safeBase);
  const cleanPathname = trimTrailingSlash(parsed.pathname);
  if (cleanPathname.endsWith(suffixPath)) {
    parsed.pathname = cleanPathname;
    return parsed.toString();
  }

  return buildUrl(safeBase, suffixPath);
}

/**
 * Sends a JSON POST request with `AbortController` timeout enforcement and single-pass body parsing.
 */
export async function postJsonWithTimeout(params: {
  endpoint: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  timeoutMs: number;
  providerLabel: string;
}): Promise<unknown> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeoutError = new Error(
    `LLM request (${params.providerLabel}) timed out after ${params.timeoutMs}ms`
  );
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(timeoutError);
    }, params.timeoutMs);
  });

  const requestPromise = (async (): Promise<unknown> => {
    const response = await fetch(params.endpoint, {
      method: 'POST',
      headers: {
        [HTTP_HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON,
        [HTTP_HEADERS.ACCEPT]: CONTENT_TYPE.JSON,
        ...params.headers
      },
      body: JSON.stringify(params.body),
      signal: controller.signal
    });

    const hasTextMethod = typeof response.text === 'function';
    const bodyText = hasTextMethod ? await response.text() : '';
    if (!isHttpSuccess(response.status) || !response.ok) {
      const errorDetail = isNonEmptyString(bodyText) ? `: ${truncate(bodyText.trim(), 240)}` : '';
      throw new Error(
        `LLM provider '${params.providerLabel}' returned HTTP ${response.status}${errorDetail}`
      );
    }

    if (hasTextMethod) {
      return isNonEmptyString(bodyText) ? safeJsonParse<unknown>(bodyText) : null;
    }

    if (typeof response.json === 'function') {
      return await response.json();
    }

    return null;
  })();
  requestPromise.catch(() => undefined);

  try {
    return await Promise.race([requestPromise, timeoutPromise]);
  } catch (err) {
    if (controller.signal.aborted) {
      throw timeoutError;
    }
    throw err;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
