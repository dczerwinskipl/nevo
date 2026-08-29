import { useEffect, useRef, useState } from 'react';

export function useChatVisualViewport() {
  const [viewport, setViewport] = useState<{ height: number | null; offsetTop: number; keyboardOpen: boolean }>({
    height: null,
    offsetTop: 0,
    keyboardOpen: false,
  });
  const baselineHeight = useRef(0);

  useEffect(() => {
    const visualViewport = window.visualViewport;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const height = visualViewport ? Math.round(visualViewport.height) : window.innerHeight;
        const offsetTop = visualViewport ? Math.max(0, Math.round(visualViewport.offsetTop)) : 0;
        baselineHeight.current = Math.max(baselineHeight.current, height);
        const active = document.activeElement;
        const keyboard = Boolean(
          active &&
          (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.getAttribute('contenteditable') === 'true') &&
          visualViewport &&
          visualViewport.height < baselineHeight.current - 80
        );
        setViewport({
          height: visualViewport ? Math.round(visualViewport.height) : null,
          offsetTop,
          keyboardOpen: keyboard,
        });
      });
    };

    const resetBaseline = () => {
      baselineHeight.current = 0;
      measure();
    };

    measure();
    visualViewport?.addEventListener('resize', measure);
    visualViewport?.addEventListener('scroll', measure);
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', resetBaseline);
    document.addEventListener('focusin', measure);
    document.addEventListener('focusout', measure);
    return () => {
      cancelAnimationFrame(frame);
      visualViewport?.removeEventListener('resize', measure);
      visualViewport?.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', resetBaseline);
      document.removeEventListener('focusin', measure);
      document.removeEventListener('focusout', measure);
    };
  }, []);

  return viewport;
}
