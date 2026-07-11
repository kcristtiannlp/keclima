/**
 * Fetch com timeout, retries e backoff exponencial.
 * @module utils/fetchRetry
 */

/**
 * @param {string|URL} url
 * @param {RequestInit & { retries?: number, retryDelay?: number, timeoutMs?: number }} [options]
 * @returns {Promise<Response>}
 */
export async function fetchRetry(url, options = {}) {
  const { retries = 2, retryDelay = 400, timeoutMs = 12000, ...init } = options;
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const parentSignal = init.signal;
    const onParentAbort = () => controller.abort();
    if (parentSignal) {
      if (parentSignal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }

    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);
      if (parentSignal) {
        parentSignal.removeEventListener('abort', onParentAbort);
      }
      if (res.ok || res.status < 500 || attempt === retries) {
        return res;
      }
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      clearTimeout(timer);
      if (parentSignal) {
        parentSignal.removeEventListener('abort', onParentAbort);
      }
      lastError = err;
      if (parentSignal?.aborted) {
        throw err;
      }
      if (err?.name === 'AbortError' && attempt === retries) {
        throw new Error('timeout');
      }
    }

    if (attempt < retries) {
      await wait(retryDelay * 2 ** attempt);
    }
  }
  throw lastError || new Error('fetch failed');
}

/**
 * @param {number} ms
 */
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
