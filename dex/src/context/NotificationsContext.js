import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

// Small, additive, session-only event log. Existing pages push exactly one
// line into this at the same point they already set their own local
// "success" state (Swap/WrapEth/NexoraFaucet) - nothing here reads from or
// writes to the chain, it just mirrors real events that already happened
// so they're visible globally from the navbar bell. Not persisted across
// reloads, never fabricated when empty.
const NotificationsContext = createContext(null);

let idCounter = 0;

export function NotificationsProvider({ children }) {
  const [notifications, setNotifications] = useState([]);

  const push = useCallback((notification) => {
    idCounter += 1;
    setNotifications((prev) =>
      [
        {
          id: idCounter,
          time: Date.now(),
          read: false,
          ...notification,
        },
        ...prev,
      ].slice(0, 30)
    );
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const value = useMemo(
    () => ({ notifications, push, markAllRead, unreadCount }),
    [notifications, push, markAllRead, unreadCount]
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) {
    throw new Error("useNotifications must be used within a NotificationsProvider");
  }
  return ctx;
}
