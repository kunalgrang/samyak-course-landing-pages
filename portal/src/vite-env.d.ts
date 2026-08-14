/// <reference types="vite/client" />

interface Window {
  turnstile?: {
    render: (
      container: HTMLElement,
      options: {
        sitekey: string;
        action?: string;
        callback: (token: string) => void;
        "expired-callback"?: () => void;
        "error-callback"?: () => void;
      },
    ) => string;
    reset: (widgetId?: string) => void;
    remove: (widgetId: string) => void;
  };
}
