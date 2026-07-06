import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

// ?forceRaf：隐藏窗口里 rAF 与 ResizeObserver 都随渲染管线挂起（自动化预览/无头验证会黑屏卡死），
// 用 setTimeout 轮询兜底驱动渲染与测量。仅在显式带参时生效，正常访问零影响。
if (new URLSearchParams(window.location.search).has('forceRaf')) {
  window.requestAnimationFrame = (cb: FrameRequestCallback) =>
    window.setTimeout(() => cb(performance.now()), 33) as unknown as number;
  window.cancelAnimationFrame = (id: number) => window.clearTimeout(id);

  class PollingResizeObserver {
    private cb: ResizeObserverCallback;
    private els = new Map<Element, { w: number; h: number }>();
    private timer: number;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
      this.timer = window.setInterval(() => this.check(), 250);
    }
    private check() {
      const entries: ResizeObserverEntry[] = [];
      this.els.forEach((last, el) => {
        const r = el.getBoundingClientRect();
        if (r.width !== last.w || r.height !== last.h) {
          this.els.set(el, { w: r.width, h: r.height });
          entries.push({ target: el, contentRect: r } as unknown as ResizeObserverEntry);
        }
      });
      if (entries.length) this.cb(entries, this as unknown as ResizeObserver);
    }
    observe(el: Element) {
      this.els.set(el, { w: -1, h: -1 }); // 强制首轮触发
    }
    unobserve(el: Element) { this.els.delete(el); }
    disconnect() { this.els.clear(); window.clearInterval(this.timer); }
  }
  (window as any).ResizeObserver = PollingResizeObserver;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
