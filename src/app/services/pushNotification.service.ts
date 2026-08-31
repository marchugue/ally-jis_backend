interface ExpoPushMessage {
  to: string;
  sound?: 'default' | null;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  badge?: number;
  channelId?: string;
  categoryId?: string;
}

/**
 * Sends one or more push notifications using the Expo Push API.
 * Supports individual Expo push tokens (ExponentPushToken[...]).
 */
export async function sendExpoPushNotification(messages: ExpoPushMessage | ExpoPushMessage[]): Promise<void> {
  const messageList = Array.isArray(messages) ? messages : [messages];
  
  // Filter out invalid/empty tokens
  const validMessages = messageList.filter(
    (msg) => msg.to && (msg.to.startsWith('ExponentPushToken[') || msg.to.startsWith('ExpoPushToken['))
  );

  if (validMessages.length === 0) return;

  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(validMessages),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[pushNotification.service] Expo push error response:', errText);
      return;
    }

    const data = await response.json();
    console.log('[pushNotification.service] Sent push notification successfully:', data);
  } catch (err) {
    console.error('[pushNotification.service] Failed to send push notification:', err);
  }
}
