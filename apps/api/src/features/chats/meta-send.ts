export type MetaSendConfig = { token: string; endpoint_id: string; host?: 'facebook' | 'instagram' };
export type SendResult = { status: 'sent'; messageId: string } | { status: 'failed' | 'unknown'; code: string };

// Only known Meta hosts are allowed. Config cannot send tokens to arbitrary URLs.
export async function sendMetaText(
  config: MetaSendConfig, platform: 'facebook' | 'instagram', customerId: string, text: string,
  version: string, fetcher: typeof fetch = fetch,
): Promise<SendResult> {
  if (!config || typeof config !== 'object' || typeof config.token !== 'string' ||
    !/^v\d+\.0$/.test(version) || typeof config.endpoint_id !== 'string' || !/^\d+$/.test(config.endpoint_id) || !config.token ||
    (config.host !== undefined && !['facebook', 'instagram'].includes(config.host)) ||
    (platform === 'facebook' && config.host === 'instagram')) {
    return { status: 'failed', code: 'INVALID_CHANNEL_CONFIG' };
  }
  const host = config.host === 'instagram' ? 'graph.instagram.com' : 'graph.facebook.com';
  try {
    const response = await fetcher(`https://${host}/${version}/${config.endpoint_id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: customerId }, message: { text },
        ...(platform === 'facebook' ? { messaging_type: 'RESPONSE' } : {}) }),
      signal: AbortSignal.timeout(15000),
    });
    const body = await response.json() as { message_id?: string; error?: { code?: number; error_subcode?: number } };
    if (!response.ok) {
      return { status: response.status >= 500 ? 'unknown' : 'failed',
        code: `META_${body.error?.code ?? response.status}_${body.error?.error_subcode ?? 0}` };
    }
    if (typeof body.message_id !== 'string' || !body.message_id) return { status: 'unknown', code: 'META_RESPONSE_INCOMPLETE' };
    return { status: 'sent', messageId: body.message_id };
  } catch {
    // A timeout may occur after Meta accepted the request. Never auto-resend it.
    return { status: 'unknown', code: 'META_NETWORK_RESULT_UNKNOWN' };
  }
}
