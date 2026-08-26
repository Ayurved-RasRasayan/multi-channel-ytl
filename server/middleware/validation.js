// Input validation middleware for API requests

function validateChannelInput(req, res, next) {
    const { url, channelId } = req.body;
    if (!url && !channelId) {
        return res.status(400).json({
            success: false,
            error: 'Channel URL or channelId required'
        });
    }
    next();
}

function validateDownloadInput(req, res, next) {
    const { url, videoId } = req.body;
    if (!url && !videoId) {
        return res.status(400).json({
            success: false,
            error: 'Video URL or videoId required'
        });
    }
    next();
}

function validateSettingsInput(req, res, next) {
    const { downloadsDir } = req.body;
    if (!downloadsDir || typeof downloadsDir !== 'string' || !downloadsDir.trim()) {
        return res.status(400).json({
            success: false,
            error: 'Valid downloadsDir required'
        });
    }
    next();
}

module.exports = {
    validateChannelInput,
    validateDownloadInput,
    validateSettingsInput
};
