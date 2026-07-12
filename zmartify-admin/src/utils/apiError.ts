export const parseApiError = (raw: unknown): string => {
  const message = String(raw || 'Unknown error');
  const jsonStart = message.indexOf('{');
  if (jsonStart >= 0) {
    try {
      const body = JSON.parse(message.slice(jsonStart));
      if (typeof body?.detail === 'string' && body.detail.trim()) {
        return body.detail;
      }
    } catch {
      // Keep original message when response is not JSON.
    }
  }
  if (/Network error while calling/i.test(message)) {
    return 'Unable to reach backend/device. Check URL, network and TLS settings.';
  }
  return message;
};
