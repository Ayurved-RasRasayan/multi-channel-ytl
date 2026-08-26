const { z } = require('zod');

const channelSchema = z.object({
    url: z.string().optional(),
    channelId: z.string().optional(),
    name: z.string().optional()
}).refine(data => data.url || data.channelId, {
    message: 'Either url or channelId must be provided'
});

const downloadSchema = z.object({
    url: z.string().optional(),
    videoId: z.string().optional(),
    channelId: z.string().optional(),
    channelName: z.string().optional(),
    format: z.string().optional(),
    quality: z.string().optional(),
    title: z.string().optional(),
    finalFilename: z.string().optional()
}).refine(data => data.url || data.videoId, {
    message: 'Either url or videoId must be provided'
});

const settingsSchema = z.object({
    downloadsDir: z.string().min(1, 'downloadsDir required')
});

function validateWithZod(schema) {
    return (req, res, next) => {
        const result = schema.safeParse(req.body);
        if (!result.success) {
            return res.status(400).json({
                success: false,
                error: 'Validation failed',
                details: result.error.errors
            });
        }
        next();
    };
}

module.exports = {
    validateChannelZod: validateWithZod(channelSchema),
    validateDownloadZod: validateWithZod(downloadSchema),
    validateSettingsZod: validateWithZod(settingsSchema)
};
