/** One presentation rule for collector throttle states. The payload stays unchanged. */
(function initializeThrottleDisplay(global) {
    const normal = new Set(['', 'none', 'n/a', 'unthrottled']);
    const nvidiaReasons = new Set(['hw slowdown', 'sw thermal', 'hw thermal', 'power brake']);

    function parts(raw) {
        const values = Array.isArray(raw) ? raw : [raw];
        return values.flatMap(value => typeof value === 'string' ? value.slice(0, 512).split(',') : [])
            .map(value => value.trim()).filter(Boolean).slice(0, 16);
    }

    function status(raw, vendor) {
        const values = parts(raw).filter(value => !normal.has(value.toLowerCase()));
        const kind = typeof vendor === 'string' ? vendor.toLowerCase() : '';
        const alarming = kind === 'amd' ? values
            : kind === 'nvidia' ? values.filter(value => nvidiaReasons.has(value.toLowerCase())) : [];
        const display = values.length ? values.join(', ').slice(0, 80) : 'None';
        return { display, active: alarming.length > 0,
            noticeDetail: alarming.length ? alarming.join(', ').slice(0, 512) : null };
    }

    global.GPUHotThrottle = Object.freeze({ status });
})(window);
