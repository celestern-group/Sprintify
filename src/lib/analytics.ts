/**
 * Client-side Umami Analytics utility.
 * Safe to call during SSR or when Umami script is not loaded / configured.
 *
 * Umami is privacy-focused, cookie-less, and compliant with privacy regulations.
 */

declare global {
  interface Window {
    umami?: {
      track: {
        (eventName: string, eventData?: Record<string, unknown>): void;
        (
          customFunction: (
            props: Record<string, unknown>,
          ) => Record<string, unknown>,
        ): void;
      };
    };
  }
}

export type AnalyticsEventName =
  | "page_view"
  | "route_change"
  | "auth.sign_in"
  | "auth.sign_up"
  | "auth.sign_out"
  | "auth.password_reset"
  | "auth.forgot_password"
  | "auth.wishlist_request"
  | "work_item.create"
  | "work_item.update"
  | "work_item.delete"
  | "work_item.view"
  | "work_item.move"
  | "work_item.status_change"
  | "work_item.priority_change"
  | "work_item.assign"
  | "work_item.link"
  | "work_item.unlink"
  | "sprint.create"
  | "sprint.start"
  | "sprint.complete"
  | "sprint.update"
  | "sprint.delete"
  | "backlog.search"
  | "backlog.filter"
  | "backlog.view_mode_change"
  | "backlog.select_all"
  | "board.drag_drop"
  | "comment.create"
  | "comment.reaction"
  | "attachment.upload"
  | "attachment.delete"
  | "ai.generate"
  | "ai.summarize"
  | "ui.theme_toggle"
  | "ui.shortcut_press"
  | "ui.copy_button_click"
  | (string & {});

/**
 * Dispatches an event to Umami Analytics if available.
 * Swallows errors silently to avoid affecting UI interactions.
 */
export function trackEvent(
  eventName: AnalyticsEventName,
  eventData?: Record<string, unknown>,
): void {
  if (typeof window === "undefined" || !window.umami?.track) {
    return;
  }

  try {
    if (eventData) {
      window.umami.track(eventName, eventData);
    } else {
      window.umami.track(eventName);
    }
  } catch {
    // Fail silently
  }
}
