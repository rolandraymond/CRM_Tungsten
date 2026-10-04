// Only known Meta hosts are allowed. Config cannot send tokens to arbitrary URLs.
export async function sendMetaText(config, platform, customerId, text, version, fetcher = fetch) {
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
        const body = await response.json();
        if (!response.ok) {
            return { status: response.status >= 500 ? 'unknown' : 'failed',
                code: `META_${body.error?.code ?? response.status}_${body.error?.error_subcode ?? 0}` };
        }
        if (typeof body.message_id !== 'string' || !body.message_id)
            return { status: 'unknown', code: 'META_RESPONSE_INCOMPLETE' };
        return { status: 'sent', messageId: body.message_id };
    }
    catch {
        // A timeout may occur after Meta accepted the request. Never auto-resend it.
        return { status: 'unknown', code: 'META_NETWORK_RESULT_UNKNOWN' };
    }
}
//# sourceMappingURL=meta-send.js.map