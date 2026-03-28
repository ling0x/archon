export interface OllamaStreamChunk {
  model: string;
  response: string;
  done: boolean;
}

export async function* streamOllamaAnswer(
  query: string,
  context: string,
  model = 'gpt-oss:20b'
): AsyncGenerator<string> {
  const systemPrompt = [
    'You are a helpful assistant that answers questions based on provided web search results.',
    'Use the search results below as your primary source of information.',
    'Be concise, accurate, and cite facts from the sources when relevant.',
    'If the search results are not sufficient to answer the question, say so clearly.',
  ].join(' ');

  const userMessage = [
    `Question: ${query}`,
    '',
    '--- Search Results ---',
    context,
    '--- End of Search Results ---',
    '',
    'Please answer the question based on the search results above.',
  ].join('\n');

  const res = await fetch('/ollama/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      system: systemPrompt,
      prompt: userMessage,
      stream: true,
    }),
  });

  if (!res.ok) {
    throw new Error(`Ollama error: ${res.status} ${res.statusText}`);
  }

  if (!res.body) throw new Error('No response body from Ollama');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const lines = decoder.decode(value, { stream: true }).split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const chunk: OllamaStreamChunk = JSON.parse(line);
        if (chunk.response) yield chunk.response;
        if (chunk.done) return;
      } catch {
        // skip malformed lines
      }
    }
  }
}
