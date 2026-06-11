export function getPrivacyMode() {
  try {
    return localStorage.getItem('privacyMode') || 'local';
  } catch {
    return 'local';
  }
}

export function setPrivacyMode(mode) {
  try {
    localStorage.setItem('privacyMode', mode);
  } catch {}
}

export async function getInterpretation(question, cards, privacyMode) {
  if (privacyMode === 'local') {
    return { interpretation: getFallbackInterpretation(question, cards), source: 'local' };
  }

  try {
    const sanitized = cards.map(c => ({
      id: c.id,
      title: c.title,
      summary: c.summary || '',
      scenario: c.scenario || '',
      position: c.position,
      positionLabel: c.positionLabel || '',
      keyPoints: c.keyPoints || [],
    }));

    const res = await fetch('/api/interpret', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, cards: sanitized }),
    });

    if (!res.ok) throw new Error(`API error: ${res.status}`);

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream')) {
      return await handleSSEStream(res);
    }

    const data = await res.json();
    return { interpretation: data.interpretation, source: data.source || 'ai' };
  } catch {
    return { interpretation: getFallbackInterpretation(question, cards), source: 'local' };
  }
}

export function getFallbackInterpretation(question, cards) {
  const cardReadings = cards.map(c => {
    const label = c.positionLabel || c.position || '';
    const points = (c.keyPoints && c.keyPoints.length > 0)
      ? c.keyPoints.slice(0, 3).map(kp => `  · ${kp}`).join('\n')
      : '';
    return `【${label}】${c.title}\n${c.summary || ''}\n${c.scenario ? '适用：' + c.scenario : ''}\n${points}`;
  }).join('\n\n');

  return `你问的是：「${question}」\n\n${cardReadings}`;
}

async function handleSSEStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data);
        if (parsed.type === 'text' && parsed.text) {
          fullText += parsed.text;
          window.dispatchEvent(new CustomEvent('ai-stream', { detail: { text: fullText, chunk: parsed.text } }));
        }
      } catch {}
    }
  }

  return { interpretation: fullText, source: 'ai' };
}
