'use strict';

/**
 * Screenshots go to R2, not into a Telegram chat.
 *
 * A photo pasted into a chat is a photo only a person can look at: the agent
 * that now reads these requests cannot open it, and neither can the dashboard.
 * The same media gateway the rest of the fleet uses takes the bytes and gives
 * back a URL, which travels fine through JSON, a database row and a prompt.
 */

const GATEWAY = process.env.MEDIA_GW_URL || 'https://teampro-media-gw.team-pro-record.workers.dev';

async function uploadToR2(key, buffer, contentType = 'image/jpeg') {
  const serviceKey = process.env.MEDIA_GW_KEY;
  if (!serviceKey) throw new Error('MEDIA_GW_KEY is not set');

  const response = await fetch(`${GATEWAY}/`, {
    method: 'PUT',
    headers: {
      'x-service-key': serviceKey,
      'x-file-key': String(key).replace(/^\/+/, ''),
      'Content-Type': contentType,
    },
    body: buffer,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`R2 ${response.status}: ${detail.slice(0, 140)}`);
  }
  return (await response.json()).url;
}

module.exports = { uploadToR2, GATEWAY };
