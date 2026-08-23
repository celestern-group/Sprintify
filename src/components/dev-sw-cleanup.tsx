"use client";

import { useEffect } from "react";

/**
 * Dev-only: unregisters any service worker left over from a build where
 * SerwistProvider registered one, and clears its caches. Without this, an
 * already-installed SW keeps intercepting Turbopack HMR chunk requests
 * (ChunkLoadError) even after registration is disabled in development.
 */
export function DevServiceWorkerCleanup() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) {
        registration.unregister();
      }
    });

    if ("caches" in window) {
      caches.keys().then((keys) => {
        for (const key of keys) {
          caches.delete(key);
        }
      });
    }
  }, []);

  return null;
}
