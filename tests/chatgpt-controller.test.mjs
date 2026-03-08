import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';

import { ChatGPTController } from '../chatgpt-controller.mjs';

const selectors = {
  promptTextarea: '#prompt-textarea, textarea, [role="textbox"], [contenteditable="true"]',
  sendButton: 'button[data-testid="send-button"], button[aria-label*="send" i], button[type="submit"]',
  stopButton: 'button[data-testid="stop-button"], button[aria-label*="stop" i]',
  assistantMessage: '[data-message-author-role="assistant"], [data-testid*="assistant" i], [data-testid="chat-message"]',
  composerRoot: 'form, main'
};

function makeController(respond) {
  const inputEvents = [];
  const webContents = {
    async executeJavaScript(js) {
      return await respond(js);
    },
    sendInputEvent(event) {
      inputEvents.push(event);
    },
    async insertText(text) {
      inputEvents.push({ type: 'insertText', text });
    },
    getURL() {
      return 'https://chatgpt.com/';
    },
    debugger: {
      isAttached() {
        return false;
      },
      attach() {},
      detach() {},
      async sendCommand() {
        return {};
      }
    }
  };

  const controller = new ChatGPTController({
    webContents,
    loadURL: async () => {},
    selectors,
    onBlocked: async () => {},
    onUnblocked: async () => {},
    stateDir: os.tmpdir()
  });

  return { controller, inputEvents };
}

test('chatgpt-controller: query serializes concurrent calls on one tab', async () => {
  let activeTypePrompt = 0;
  let maxActiveTypePrompt = 0;
  let releaseFirstTypePrompt;
  const firstTypePromptGate = new Promise((resolve) => {
    releaseFirstTypePrompt = resolve;
  });
  let typePromptCalls = 0;
  let clickSendCalls = 0;
  const assistantPollsByQuery = new Map();

  const { controller } = makeController(async (js) => {
    if (js.includes('const url = location.href ||')) {
      return { blocked: false, promptVisible: true, readyState: 'complete' };
    }
    if (js.includes("missing_prompt_textarea")) {
      typePromptCalls += 1;
      activeTypePrompt += 1;
      maxActiveTypePrompt = Math.max(maxActiveTypePrompt, activeTypePrompt);
      if (typePromptCalls === 1) await firstTypePromptGate;
      activeTypePrompt -= 1;
      return { ok: true, kind: 'textarea', rect: { x: 8, y: 8, w: 400, h: 48 } };
    }
    if (js.includes("already_generating")) {
      clickSendCalls += 1;
      return { ok: true, rect: { x: 16, y: 16, w: 24, h: 24 }, host: 'chatgpt.com' };
    }
    if (js.includes('return { stopVisible') && js.includes('promptLen')) {
      return { stopVisible: true, sendDisabled: false, promptLen: 0 };
    }
    if (js.includes('const hasAssistantNodes = nodes.length > 0')) {
      const queryId = clickSendCalls;
      const polls = (assistantPollsByQuery.get(queryId) || 0) + 1;
      assistantPollsByQuery.set(queryId, polls);
      if (polls === 1) {
        return {
          stop: true,
          sendEnabled: false,
          assistantTxt: '',
          pageTxt: 'ChatGPT home shell',
          txt: 'ChatGPT home shell',
          count: 0,
          usedFallback: true,
          hasError: false,
          hasContinue: false,
          hasRegenerate: false,
          broadCount: 0,
          broadTail: [],
          url: 'https://chatgpt.com/'
        };
      }
      return {
        stop: false,
        sendEnabled: true,
        assistantTxt: 'answer ready',
        pageTxt: 'answer ready',
        txt: 'answer ready',
        count: 1,
        usedFallback: false,
        hasError: false,
        hasContinue: false,
        hasRegenerate: false,
        broadCount: 1,
        broadTail: [],
        url: 'https://chatgpt.com/'
      };
    }
    if (js.includes('codeBlocks: codes')) {
      return { codeBlocks: [] };
    }
    throw new Error(`unhandled executeJavaScript payload: ${js.slice(0, 120)}`);
  });

  const q1 = controller.query({ prompt: 'first', timeoutMs: 6000 });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const q2 = controller.query({ prompt: 'second', timeoutMs: 6000 });
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(maxActiveTypePrompt, 1);

  releaseFirstTypePrompt();
  const [r1, r2] = await Promise.all([q1, q2]);

  assert.equal(r1.text, 'answer ready');
  assert.equal(r2.text, 'answer ready');
  assert.equal(maxActiveTypePrompt, 1);
});

test('chatgpt-controller: query falls back to stable page text after observed response activity', async () => {
  let assistantPolls = 0;

  const { controller } = makeController(async (js) => {
    if (js.includes('const url = location.href ||')) {
      return { blocked: false, promptVisible: true, readyState: 'complete' };
    }
    if (js.includes("missing_prompt_textarea")) {
      return { ok: true, kind: 'textarea', rect: { x: 8, y: 8, w: 400, h: 48 } };
    }
    if (js.includes("already_generating")) {
      return { ok: true, rect: { x: 16, y: 16, w: 24, h: 24 }, host: 'chatgpt.com' };
    }
    if (js.includes('return { stopVisible') && js.includes('promptLen')) {
      return { stopVisible: false, sendDisabled: true, promptLen: 11 };
    }
    if (js.includes('const hasAssistantNodes = nodes.length > 0')) {
      assistantPolls += 1;
      if (assistantPolls === 1) {
        return {
          stop: true,
          sendEnabled: false,
          assistantTxt: '',
          pageTxt: 'ChatGPT home shell',
          txt: 'ChatGPT home shell',
          count: 0,
          usedFallback: true,
          hasError: false,
          hasContinue: false,
          hasRegenerate: false,
          broadCount: 0,
          broadTail: [],
          url: 'https://chatgpt.com/'
        };
      }
      return {
        stop: false,
        sendEnabled: true,
        assistantTxt: '',
        pageTxt: 'ChatGPT home shell\nMR000001 keep\nMR000002 exclude',
        txt: 'ChatGPT home shell\nMR000001 keep\nMR000002 exclude',
        count: 0,
        usedFallback: true,
        hasError: false,
        hasContinue: false,
        hasRegenerate: false,
        broadCount: 1,
        broadTail: [],
        url: 'https://chatgpt.com/'
      };
    }
    if (js.includes('codeBlocks: codes')) {
      return { codeBlocks: [] };
    }
    throw new Error(`unhandled executeJavaScript payload: ${js.slice(0, 120)}`);
  });

  const result = await controller.query({ prompt: 'screen these', timeoutMs: 2500 });
  assert.match(result.text, /MR000001 keep/);
  assert.equal(result.meta.count, 0);
});

test('chatgpt-controller: send accepts disabled send button as evidence submission started', async () => {
  let sendSignalPolls = 0;
  let fallbackButtonClicks = 0;
  const { controller, inputEvents } = makeController(async (js) => {
    if (js.includes('const url = location.href ||')) {
      return { blocked: false, promptVisible: true, readyState: 'complete' };
    }
    if (js.includes("missing_prompt_textarea")) {
      return { ok: true, kind: 'textarea', rect: { x: 8, y: 8, w: 400, h: 48 } };
    }
    if (js.includes("already_generating")) {
      return { ok: true, rect: { x: 16, y: 16, w: 24, h: 24 }, host: 'chatgpt.com' };
    }
    if (js.includes('return { stopVisible') && js.includes('promptLen')) {
      sendSignalPolls += 1;
      if (sendSignalPolls === 1) return { stopVisible: false, sendDisabled: true, promptLen: 14 };
      return { stopVisible: false, sendDisabled: false, promptLen: 14 };
    }
    if (js.includes('const btn = document.querySelector(')) {
      fallbackButtonClicks += 1;
      return false;
    }
    throw new Error(`unhandled executeJavaScript payload: ${js.slice(0, 120)}`);
  });

  const result = await controller.send({ text: 'screen these now', timeoutMs: 1500 });

  assert.deepEqual(result, { ok: true });
  assert.equal(fallbackButtonClicks, 0);
  assert.equal(inputEvents.some((event) => event.keyCode === 'Enter'), false);
});
