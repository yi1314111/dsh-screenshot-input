/**
 * Screenshot input — Client module.
 *
 * Adds one compact control to the composer tool row. A click captures a single
 * frame from a screen/window/tab the user picks (or, where the browser cannot
 * offer that picker, reads an image the user just copied) and stages it through
 * the Conversation service as an ordinary draft image attachment. Previews,
 * limits, submission and durable storage therefore stay owned by the shipped
 * composer pipeline.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-screenshot-input',
  factory(require) {
    'use strict';

    const React = require('react');
    const h = React.createElement;

    const NS = 'screenshot-input';

    const DICT = {
      en: {
        'action.label': 'Screenshot input',
        'action.busy': 'Capturing…',
        'action.hint': 'Start a snip (same as Win+Shift+S) and add the selected region to the draft',
        'notice.unsupported':
          'Screen capture is unavailable here. Take a system screenshot, then paste it into the composer.',
        'notice.clipboardEmpty':
          'No image in the clipboard. Copy a screenshot first (Win+Shift+S), then click again.',
        'notice.clipboardDenied':
          'Clipboard images are blocked. Allow clipboard access, or paste the screenshot directly.',
        'notice.captureFailed': 'The screen could not be captured. Try again.',
        'notice.snipUnavailable':
          'The system snip could not start. Press Win+Shift+S, then paste the screenshot into the composer.',
        'notice.busy': 'The previous snip is still in progress.',
        'notice.attachFailed': 'The screenshot could not be added to the draft. Try again.',
        'notice.unavailable': 'Screenshot input is unavailable in this session.',
        'notice.noSession': 'Select a session first.',
        'notice.sessionChanged': 'The session changed while capturing; the screenshot was discarded.',
        'notice.tooMany': 'A message can hold at most {count} images.',
        'notice.tooLarge': 'The screenshot exceeds the {size} per-image limit.',
        'notice.dismiss': 'Click to dismiss',
      },
      zh: {
        'action.label': '截图输入',
        'action.busy': '正在截取…',
        'action.hint': '点击开始截图（等同 Win+Shift+S），框选区域后加入输入框',
        'notice.unsupported': '当前环境不支持屏幕截取。请先系统截图（Win+Shift+S），再直接粘贴到输入框。',
        'notice.clipboardEmpty': '剪贴板中没有图片。请先复制截图（Win+Shift+S），再点击按钮。',
        'notice.clipboardDenied': '无法读取剪贴板图片。请允许剪贴板权限，或直接把截图粘贴到输入框。',
        'notice.captureFailed': '截取屏幕失败，请重试。',
        'notice.snipUnavailable': '系统截图未能启动。请按 Win+Shift+S 截取后粘贴到输入框。',
        'notice.busy': '上一次截图还没有结束。',
        'notice.attachFailed': '截图未能加入输入框，请重试。',
        'notice.unavailable': '当前会话暂不支持截图输入。',
        'notice.noSession': '请先选择会话。',
        'notice.sessionChanged': '截取期间会话已切换，截图已丢弃。',
        'notice.tooMany': '一条消息最多添加 {count} 张图片。',
        'notice.tooLarge': '截图超过单张图片大小上限（{size}）。',
        'notice.dismiss': '点击关闭',
      },
    };

    /* Copy of the shipped composer `add` control geometry and states. */
    const BUTTON_CSS = [
      '.ssi-button{corner-shape:round;background:var(--dsw-specific-selector,var(--dsw-alias-bg-layer-2));',
      'width:28px;height:28px;color:var(--dsw-alias-label-primary);cursor:pointer;border:none;',
      'border-radius:999px;flex:none;place-items:center;display:grid;padding:0;transition:background-color .1s}',
      '.ssi-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid,var(--dsw-alias-bg-layer-2))}',
      '.ssi-button:disabled{opacity:.5;cursor:default}',
      '.ssi-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.ssi-button[data-busy=true] svg{animation:ssi-input-pulse 1s ease-in-out infinite alternate}',
      '@keyframes ssi-input-pulse{0%{opacity:.35}to{opacity:1}}',
    ].join('');

    const NOTICE_CSS = [
      '.ssi-notice{max-width:var(--dsh-composer-card-max-width,560px);border-radius:var(--dsw-radius-md,8px);',
      'background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);',
      'padding:4px 8px;font-size:12px;line-height:18px;cursor:pointer}',
      '.ssi-notice[data-tone=error]{color:var(--dsw-alias-state-error-primary)}',
    ].join('');

    const ICON = h(
      'svg',
      {
        viewBox: '0 0 16 16',
        width: 16,
        height: 16,
        fill: 'none',
        'aria-hidden': true,
        focusable: 'false',
      },
      h('path', {
        d:
          'M2.25 5.25V3.9c0-.91.74-1.65 1.65-1.65h1.35M10.75 2.25h1.35c.91 0 1.65.74 1.65 1.65v1.35' +
          'M13.75 10.75v1.35c0 .91-.74 1.65-1.65 1.65h-1.35M5.25 13.75H3.9c-.91 0-1.65-.74-1.65-1.65v-1.35',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
      h('circle', { cx: 8, cy: 8, r: 2.1, stroke: 'currentColor', strokeWidth: 1.4 }),
    );

    /** Transient one-line status store shared by the button and its dock entry. */
    function createNoticeStore() {
      let current = null;
      let seq = 0;
      const listeners = new Set();
      const emit = () => {
        for (const listener of listeners) listener();
      };
      return {
        get: () => current,
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        publish(text, tone) {
          seq += 1;
          current = { id: seq, text, tone: tone === 'info' ? 'info' : 'error' };
          emit();
        },
        clear(id) {
          if (current === null) return;
          if (id !== undefined && current.id !== id) return;
          current = null;
          emit();
        },
      };
    }

    const useNoticeStore =
      typeof React.useSyncExternalStore === 'function'
        ? (store) => React.useSyncExternalStore(store.subscribe, store.get, store.get)
        : (store) => {
            const [value, setValue] = React.useState(store.get());
            React.useEffect(() => store.subscribe(() => setValue(store.get())), [store]);
            return value;
          };

    function formatBytes(bytes) {
      if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return '0 B';
      const units = ['B', 'KB', 'MB', 'GB'];
      let value = bytes;
      let unit = 0;
      while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
      }
      return `${unit === 0 || value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
    }

    function fileStamp(extension) {
      const now = new Date();
      const pad = (value) => String(value).padStart(2, '0');
      const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
      const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      return `screenshot-${date}-${time}.${extension}`;
    }

    function stopStream(stream) {
      try {
        for (const track of stream.getTracks()) track.stop();
      } catch (error) {
        /* A stopped or partially constructed stream needs no cleanup. */
      }
    }

    function supportsDisplayCapture() {
      return (
        typeof navigator !== 'undefined' &&
        navigator.mediaDevices != null &&
        typeof navigator.mediaDevices.getDisplayMedia === 'function'
      );
    }

    /** Resolve once the video element has a drawable frame, or after a bounded wait. */
    function waitForVideoFrame(video) {
      return new Promise((resolve) => {
        let settled = false;
        let timer;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve();
        };
        timer = setTimeout(finish, 1500);
        if (typeof video.requestVideoFrameCallback === 'function') {
          try {
            video.requestVideoFrameCallback(() => finish());
            return;
          } catch (error) {
            /* Fall through to the bounded wait. */
          }
        }
        setTimeout(finish, 150);
      });
    }

    /** Encode the captured frame as a PNG File, downscaling only when a limit requires it. */
    async function frameToFile(video, stream, limits) {
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) return null;

      // Copy the frame while the stream is still live; every later read uses this bitmap.
      const raw = document.createElement('canvas');
      raw.width = width;
      raw.height = height;
      const rawContext = raw.getContext('2d');
      if (rawContext === null) return null;
      rawContext.drawImage(video, 0, 0, width, height);
      stopStream(stream);

      const maxPixels = limits && typeof limits.maxImagePixels === 'number' ? limits.maxImagePixels : 0;
      const maxBytes = limits && typeof limits.maxImageBytes === 'number' ? limits.maxImageBytes : 0;
      let scale = maxPixels > 0 && width * height > maxPixels ? Math.sqrt(maxPixels / (width * height)) : 1;

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (context === null) return null;

      let blob = null;
      try {
        for (let attempt = 0; attempt < 6; attempt += 1) {
          const targetWidth = Math.max(1, Math.round(width * scale));
          const targetHeight = Math.max(1, Math.round(height * scale));
          canvas.width = targetWidth;
          canvas.height = targetHeight;
          context.drawImage(raw, 0, 0, targetWidth, targetHeight);
          blob = await new Promise((resolve) => {
            canvas.toBlob(resolve, 'image/png');
          });
          if (blob === null) return null;
          if (maxBytes === 0 || blob.size <= maxBytes) break;
          if (targetWidth <= 64 || targetHeight <= 64) break;
          scale *= 0.8;
        }
      } finally {
        canvas.width = 1;
        canvas.height = 1;
        raw.width = 1;
        raw.height = 1;
      }

      if (blob === null) return null;
      return new File([blob], fileStamp('png'), { type: 'image/png', lastModified: Date.now() });
    }

    async function captureFromScreen(limits, signal) {
      let stream;
      const startedAt = Date.now();
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      } catch (error) {
        const name = error && error.name;
        const elapsed = Date.now() - startedAt;
        // A blocked capture fails immediately; a picker the user closed takes real
        // interaction time. Only the immediate failure means "try the clipboard".
        if ((name === 'NotAllowedError' || name === 'AbortError') && elapsed >= 400) return { code: 'cancelled' };
        return { code: 'unsupported' };
      }
      if (signal !== undefined && signal.aborted) {
        stopStream(stream);
        return { code: 'cancelled' };
      }
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      try {
        await video.play().catch(() => {});
        await waitForVideoFrame(video);
        if (signal !== undefined && signal.aborted) return { code: 'cancelled' };
        const file = await frameToFile(video, stream, limits);
        if (file === null) return { code: 'captureFailed' };
        if (signal !== undefined && signal.aborted) return { code: 'cancelled' };
        return { code: 'image', file };
      } catch (error) {
        return { code: 'captureFailed' };
      } finally {
        stopStream(stream);
        video.pause();
        video.srcObject = null;
      }
    }

    async function captureFromClipboard() {
      const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
      if (clipboard === undefined || clipboard === null || typeof clipboard.read !== 'function') {
        return { code: 'unsupported' };
      }
      let items;
      try {
        items = await clipboard.read();
      } catch (error) {
        return { code: 'clipboardDenied' };
      }
      for (const item of items) {
        const type = item.types.find(
          (candidate) => candidate === 'image/png' || candidate === 'image/jpeg' || candidate === 'image/webp',
        );
        if (type === undefined) continue;
        const extension = type === 'image/jpeg' ? 'jpg' : type === 'image/webp' ? 'webp' : 'png';
        try {
          const blob = await item.getType(type);
          return { code: 'image', file: new File([blob], fileStamp(extension), { type, lastModified: Date.now() }) };
        } catch (error) {
          return { code: 'clipboardDenied' };
        }
      }
      return { code: 'clipboardEmpty' };
    }

    async function captureImage(options) {
      const limits = options ? options.limits : undefined;
      const signal = options ? options.signal : undefined;
      if (supportsDisplayCapture()) {
        const outcome = await captureFromScreen(limits, signal);
        if (outcome.code !== 'unsupported') return outcome;
      }
      return await captureFromClipboard();
    }

    function snipRouteUrl() {
      try {
        return new URL('/screenshot-input/snip', document.baseURI).href;
      } catch (error) {
        return '/screenshot-input/snip';
      }
    }

    /**
     * Ask the Host half to run the system snip (Win+Shift+S) and answer with the
     * captured PNG. `unavailable` means this composition has no native route, so
     * the caller may fall back to browser capture.
     */
    async function snipFromHost(options) {
      const signal = options ? options.signal : undefined;
      let response;
      try {
        response = await fetch(snipRouteUrl(), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
          cache: 'no-store',
          signal,
        });
      } catch (error) {
        return { code: 'unavailable' };
      }
      const type = response.headers.get('content-type') ?? '';
      if (response.ok && type.startsWith('image/')) {
        try {
          const blob = await response.blob();
          return { code: 'image', file: new File([blob], fileStamp('png'), { type: 'image/png', lastModified: Date.now() }) };
        } catch (error) {
          return { code: 'captureFailed' };
        }
      }
      if (response.ok) return { code: 'unavailable' };
      if (response.status === 404) return { code: 'unavailable' };
      if (response.status === 408) return { code: 'cancelled' };
      if (response.status === 409) return { code: 'busy' };
      return { code: 'snipFailed' };
    }

    /** Resolve the scope-addressed Conversation service that owns draft attachments. */
    function resolveConversation(ctx, sessionId) {
      try {
        const direct = ctx.get('conversation');
        if (direct !== undefined && direct !== null && typeof direct.createDrafts === 'function') return direct;
      } catch (error) {
        /* An undeclared service may be refused by a restricted context. */
      }
      try {
        const sessions = ctx.get('sessions');
        const scope = sessions !== undefined && typeof sessions.scope === 'function' ? sessions.scope(sessionId) : undefined;
        const scoped = scope !== undefined && scope !== null ? scope.get('conversation') : undefined;
        if (scoped !== undefined && scoped !== null && typeof scoped.createDrafts === 'function') return scoped;
      } catch (error) {
        /* Fall through to the unavailable outcome. */
      }
      return undefined;
    }

    function stageImage(ctx, options) {
      const { sessionId, file, attachmentIds, limits, inputActions } = options;
      if (sessionId === undefined || sessionId === null) return { code: 'noSession' };
      if (inputActions === undefined || typeof inputActions.addAttachments !== 'function') {
        return { code: 'unavailable' };
      }
      const conversation = resolveConversation(ctx, sessionId);
      if (conversation === undefined) return { code: 'unavailable' };
      const ids = Array.isArray(attachmentIds) ? attachmentIds : [];

      if (limits !== undefined && limits !== null) {
        let images = 0;
        try {
          const current =
            typeof conversation.resolveDraftAttachments === 'function'
              ? conversation.resolveDraftAttachments(ids)
              : [];
          images = current.filter((attachment) => attachment.kind === 'image').length;
        } catch (error) {
          images = 0;
        }
        if (typeof limits.maxImagesPerMessage === 'number' && images >= limits.maxImagesPerMessage) {
          return { code: 'tooMany', params: { count: limits.maxImagesPerMessage } };
        }
        if (typeof limits.maxImageBytes === 'number' && file.size > limits.maxImageBytes) {
          return { code: 'tooLarge', params: { size: formatBytes(limits.maxImageBytes) } };
        }
      }

      let drafts;
      try {
        drafts = conversation.createDrafts(sessionId, [file]);
      } catch (error) {
        return { code: 'attachFailed' };
      }
      if (!Array.isArray(drafts) || drafts.length === 0) return { code: 'attachFailed' };
      if (!inputActions.addAttachments(drafts.map((draft) => draft.id))) {
        try {
          conversation.releaseDraftAttachments(drafts);
        } catch (error) {
          /* The staging failure is already reported. */
        }
        return { code: 'attachFailed' };
      }
      return { code: 'staged' };
    }

    const NOTICES = {
      unsupported: { key: 'notice.unsupported', tone: 'info' },
      clipboardEmpty: { key: 'notice.clipboardEmpty', tone: 'info' },
      sessionChanged: { key: 'notice.sessionChanged', tone: 'info' },
      busy: { key: 'notice.busy', tone: 'info' },
      clipboardDenied: { key: 'notice.clipboardDenied', tone: 'error' },
      captureFailed: { key: 'notice.captureFailed', tone: 'error' },
      snipFailed: { key: 'notice.snipUnavailable', tone: 'error' },
      attachFailed: { key: 'notice.attachFailed', tone: 'error' },
      unavailable: { key: 'notice.unavailable', tone: 'error' },
      noSession: { key: 'notice.noSession', tone: 'error' },
      tooMany: { key: 'notice.tooMany', tone: 'error' },
      tooLarge: { key: 'notice.tooLarge', tone: 'error' },
    };

    function publishNotice(t, notice, outcome) {
      const entry = outcome !== undefined && outcome !== null ? NOTICES[outcome.code] : undefined;
      if (entry === undefined) return;
      notice.publish(t(entry.key, outcome.params), entry.tone);
    }

    function ScreenshotButton(props) {
      const { sessionId, inputActions, useInput, useProjection, useSession, t, snip, capture, stage, notice } = props;
      const [busy, setBusy] = React.useState(false);
      const busyPhase = useInput((state) => state.phase === 'adjudicating' || state.phase === 'submitting');
      const attachmentIds = useInput((state) => state.attachmentIds);
      const imageLimits = useProjection('imageLimits', (limits) => limits);
      const removed = useSession((state) => (state === undefined || state === null ? false : state.removed === true));
      const subagent = useSession((state) => (state === undefined || state === null ? null : state.subagent || null));

      const latest = React.useRef({ sessionId, attachmentIds, imageLimits });
      latest.current = { sessionId, attachmentIds, imageLimits };

      const mounted = React.useRef(true);
      const abort = React.useRef(null);
      React.useEffect(
        () => () => {
          mounted.current = false;
          if (abort.current !== null) abort.current.abort();
        },
        [],
      );

      const continuable = subagent !== null && subagent.address !== undefined && subagent.address.mode === 'continuable';
      const readOnly =
        removed || (subagent !== null && !continuable) || (continuable && subagent.parentAvailable !== true);
      const disabled = busy || busyPhase || readOnly || sessionId === undefined;

      const onClick = async () => {
        if (disabled) return;
        const requested = latest.current;
        const controller = new AbortController();
        abort.current = controller;
        setBusy(true);
        try {
          let outcome = await snip({ signal: controller.signal });
          if (outcome.code === 'unavailable') {
            outcome = await capture({ limits: requested.imageLimits, signal: controller.signal });
          }
          if (!mounted.current || controller.signal.aborted) return;
          if (outcome.code === 'cancelled') return;
          if (outcome.code !== 'image') {
            publishNotice(t, notice, outcome);
            return;
          }
          if (latest.current.sessionId !== requested.sessionId) {
            publishNotice(t, notice, { code: 'sessionChanged' });
            return;
          }
          const staged = stage({
            sessionId: latest.current.sessionId,
            file: outcome.file,
            attachmentIds: latest.current.attachmentIds,
            limits: latest.current.imageLimits,
            inputActions,
          });
          publishNotice(t, notice, staged);
        } finally {
          abort.current = null;
          if (mounted.current) setBusy(false);
        }
      };

      return h(
        React.Fragment,
        null,
        h('style', { key: 'ssi-button-css' }, BUTTON_CSS),
        h(
          'button',
          {
            key: 'ssi-button',
            type: 'button',
            className: 'ssi-button',
            'aria-label': busy ? t('action.busy') : t('action.label'),
            'aria-busy': busy ? 'true' : undefined,
            title: busy ? t('action.busy') : t('action.hint'),
            'data-busy': busy ? 'true' : undefined,
            disabled,
            onMouseDown: (event) => {
              event.preventDefault();
            },
            onClick: () => {
              onClick().catch(() => {});
            },
          },
          ICON,
        ),
      );
    }

    function ScreenshotNotice(props) {
      const { t, notice } = props;
      const value = useNoticeStore(notice);
      React.useEffect(() => {
        if (value === null) return undefined;
        const timer = setTimeout(() => notice.clear(value.id), 8000);
        return () => clearTimeout(timer);
      }, [value, notice]);
      if (value === null) return null;
      return h(
        React.Fragment,
        null,
        h('style', { key: 'ssi-notice-css' }, NOTICE_CSS),
        h(
          'div',
          {
            key: 'ssi-notice',
            className: 'ssi-notice',
            'data-tone': value.tone,
            role: value.tone === 'error' ? 'alert' : 'status',
            title: t('notice.dismiss'),
            onClick: () => notice.clear(value.id),
          },
          value.text,
        ),
      );
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh: DICT.zh, en: DICT.en }));
      const notice = createNoticeStore();
      const snip = (options) => snipFromHost(options);
      const capture = (options) => captureImage(options);
      const stage = (options) => stageImage(ctx, options);

      ctx.slots.inject('conversation.input.left', () =>
        ctx.slots.register(
          {
            name: 'conversation.input.left',
            id: 'screenshot-input',
            order: 0,
            locale: NS,
            inject: () => ({ snip, capture, stage, notice }),
          },
          ScreenshotButton,
        ),
      );
      ctx.slots.inject('conversation.composer.dock', () =>
        ctx.slots.register(
          {
            name: 'conversation.composer.dock',
            id: 'screenshot-input-notice',
            order: 10,
            locale: NS,
            inject: () => ({ notice }),
          },
          ScreenshotNotice,
        ),
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply,
    };
  },
});
