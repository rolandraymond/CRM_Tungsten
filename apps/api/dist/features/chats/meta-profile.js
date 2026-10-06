const cache = new Map();
const pending = new Map();
const empty = {
    name: null,
    photo_url: null,
};
export async function getFacebookCustomerProfile(config, customerId, version) {
    if (!config
        || typeof config.token !== 'string'
        || !config.token
        || typeof config.endpoint_id !== 'string'
        || !/^\d+$/.test(config.endpoint_id)
        || !/^\d+$/.test(customerId)
        || !/^v\d+\.0$/.test(version)
        || config.host === 'instagram') {
        return empty;
    }
    // Include the Page and token so profiles cannot cross channels.
    const key = JSON.stringify([
        config.endpoint_id,
        customerId,
        config.token,
        version,
    ]);
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.value;
    }
    const existing = pending.get(key);
    if (existing)
        return existing;
    // Bound concurrent requests as well as cached entries.
    if (pending.size >= 50)
        return empty;
    const request = (async () => {
        let value = empty;
        try {
            const url = new URL(`https://graph.facebook.com/${version}/${customerId}`);
            url.searchParams.set('fields', 'first_name,last_name,profile_pic');
            const response = await fetch(url, {
                headers: {
                    Authorization: `Bearer ${config.token}`,
                },
                signal: AbortSignal.timeout(8000),
                redirect: 'error',
            });
            if (response.ok) {
                const body = await response.json();
                const name = [body.first_name, body.last_name]
                    .filter((part) => typeof part === 'string')
                    .join(' ')
                    .trim()
                    .slice(0, 200);
                let photoUrl = null;
                if (typeof body.profile_pic === 'string') {
                    try {
                        const photo = new URL(body.profile_pic);
                        if (photo.protocol === 'https:') {
                            photoUrl = photo.href;
                        }
                    }
                    catch {
                        // Missing or invalid photo does not block the chat.
                    }
                }
                value = {
                    name: name || null,
                    photo_url: photoUrl,
                };
            }
        }
        catch {
            // Profile lookup must never prevent reading or sending messages.
        }
        cache.delete(key);
        if (cache.size >= 1000) {
            const oldest = cache.keys().next().value;
            if (oldest !== undefined)
                cache.delete(oldest);
        }
        cache.set(key, {
            value,
            expiresAt: Date.now() + (value.name ? 3_600_000 : 60_000),
        });
        return value;
    })();
    pending.set(key, request);
    try {
        return await request;
    }
    finally {
        pending.delete(key);
    }
}
//# sourceMappingURL=meta-profile.js.map