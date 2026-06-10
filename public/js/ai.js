// ai.js — AI module (ES module)

/**
 * Check if user has enabled cloud mode (read from DOM toggle).
 */
export function isCloudMode() {
  const toggle = document.getElementById('privacy-switch');
  return toggle ? toggle.getAttribute('aria-checked') === 'true' : false;
}

/**
 * Request AI interpretation from the backend.
 * Sends only: question, cards (id, title, summary, scenario, position).
 * Does NOT send full passage or file path (privacy).
 */
export async function requestInterpretation(question, cards) {
  // Strip to minimal data for privacy
  const sanitizedCards = cards.map(c => ({
    id: c.id,
    title: c.title,
    summary: c.summary || c.hook || '',
    scenario: c.scenario || '',
    position: c.position,
  }));

  const res = await fetch('/api/interpret', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question,
      cards: sanitizedCards,
      privacyMode: 'cloud',
    }),
  });

  if (!res.ok) {
    throw new Error(`Interpretation request failed: ${res.status}`);
  }

  // Check if response is SSE stream
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('text/event-stream')) {
    return await handleSSEStream(res);
  }

  // Regular JSON response (fallback case)
  return await res.json();
}

/**
 * Handle SSE stream from the server.
 */
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
          // Dispatch progress event for live rendering
          window.dispatchEvent(new CustomEvent('ai-stream', { detail: { text: fullText, chunk: parsed.text } }));
        }
      } catch {
        // skip
      }
    }
  }

  return { interpretation: fullText, source: 'ai' };
}

/**
 * Parse Claude's XML-formatted response.
 */
export function parseInterpretation(rawText) {
  if (!rawText) return { reflection: '', connection: '', question: '' };

  const extract = (tag) => {
    const match = rawText.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
    return match ? match[1].trim() : '';
  };

  const reflection = extract('reflection');
  const connection = extract('connection');
  const question = extract('question');

  // Fallback: if no XML tags found, treat entire text as reflection
  if (!reflection && !connection && !question) {
    return { reflection: rawText.trim(), connection: '', question: '' };
  }

  return { reflection, connection, question };
}
