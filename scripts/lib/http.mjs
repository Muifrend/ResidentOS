export async function fetchJson(url, options = {}) {
  const timeoutMs = options.timeoutMs || 15000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    const text = await response.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      body,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function waitForJson(url, options = {}) {
  const deadline = Date.now() + (options.timeoutMs || 15000);
  let lastError;

  while (Date.now() < deadline) {
    try {
      const result = await fetchJson(url, { timeoutMs: 3000 });
      if (result.ok) {
        return result;
      }
      lastError = new Error(`HTTP ${result.status}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  throw lastError || new Error("Timed out waiting for JSON endpoint.");
}
