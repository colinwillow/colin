// The other half of the conversation. The Worker holds the Anthropic key and the
// persona; this only carries the turns and reads the stream back.
//
// The reply arrives as plain text, streamed, so it can be spoken before it has
// finished being written. Anything past a NUL byte is a control frame for the
// page rather than speech — the Worker emits a tool call on the end of the same
// turn instead of making a second round trip — and this app has no tools yet, so
// it reads the text and drops the frame.

export interface Brain {
  /** Ask, streaming. `onText` is called with the reply so far, as it grows. */
  ask: (text: string, onText?: (soFar: string) => void) => Promise<string>;
  /** Everything said so far, oldest first. */
  readonly log: { role: 'user' | 'assistant'; content: string }[];
  /** True while a question is out. */
  readonly busy: boolean;
  forget: () => void;
}

/** The proxy is stateless, so trimming here is what bounds the token bill. */
const MAX_TURNS = 24;

export function createBrain(endpoint: string, persona?: string): Brain {
  const log: { role: 'user' | 'assistant'; content: string }[] = [];
  let busy = false;

  const ask = async (text: string, onText?: (soFar: string) => void): Promise<string> => {
    if (busy) return '';
    busy = true;
    log.push({ role: 'user', content: text });
    if (log.length > MAX_TURNS) log.splice(0, log.length - MAX_TURNS);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: log,
          persona: persona || undefined,
          // What is on screen while it answers, so it does not have to be told
          // where it is every turn.
          state: { room: true, figure: { who: 'colin', model: 'colin_stylized_01' } },
        }),
      });
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 160)}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let raw = '';
      let reply = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
        const cut = raw.indexOf('\u0000');
        reply = cut >= 0 ? raw.slice(0, cut) : raw;
        onText?.(reply);
      }
      reply = reply.trim();
      /* A REPLY THAT IS NOT THERE MUST NOT BECOME A TURN. A turn that is only a
         tool call has no text, and recording an empty assistant message poisons
         the next request. */
      if (reply) log.push({ role: 'assistant', content: reply });
      else log.pop();
      return reply;
    } catch (err) {
      log.pop();
      throw err;
    } finally {
      busy = false;
    }
  };

  return {
    ask, log,
    get busy() { return busy; },
    forget: () => { log.length = 0; },
  };
}
