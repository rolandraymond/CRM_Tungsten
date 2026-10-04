import { supabaseAuth } from '../lib/supabase.js';
export const requireAuth = async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const authorization = req.get('authorization');
    const match = authorization?.match(/^Bearer ([^\s]+)$/i);
    const token = match?.[1];
    if (!token) {
        res.status(401).json({
            error: {
                code: 'UNAUTHENTICATED',
                message: 'A Bearer access token is required',
            },
        });
        return;
    }
    try {
        const { data, error } = await supabaseAuth.auth.getUser(token);
        if (error) {
            console.warn('[Auth verification failed]', {
                status: error.status,
                code: error.code,
                message: error.message,
            });
            const authUnavailable = !error.status ||
                error.status >= 500 ||
                error.status === 429;
            res.status(authUnavailable ? 503 : 401).json({
                error: {
                    code: authUnavailable
                        ? 'AUTH_UNAVAILABLE'
                        : 'UNAUTHENTICATED',
                    message: authUnavailable
                        ? 'Authentication service is temporarily unavailable'
                        : 'Invalid or expired access token',
                },
            });
            return;
        }
        if (!data.user) {
            res.status(401).json({
                error: {
                    code: 'UNAUTHENTICATED',
                    message: 'User not found',
                },
            });
            return;
        }
        res.locals.auth = {
            userId: data.user.id,
            email: data.user.email ?? null,
            accessToken: token,
        };
        next();
    }
    catch {
        res.status(503).json({
            error: {
                code: 'AUTH_UNAVAILABLE',
                message: 'Authentication service is temporarily unavailable',
            },
        });
    }
};
//# sourceMappingURL=require-auth.js.map