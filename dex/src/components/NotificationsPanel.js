import React from "react";
import EmptyState from "./ui/EmptyState";
import { useNotifications } from "../context/NotificationsContext";
import "./NotificationsPanel.css";

const KIND_ICON = {
  swap: "🔁",
  liquidity: "💧",
  claim: "🚰",
  system: "⚙️",
};

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function NotificationsPanel({ onClose }) {
  const { notifications, markAllRead } = useNotifications();

  return (
    <>
      <div className="nx-notif-backdrop" onClick={onClose} />
      <div className="nx-notif-panel" role="dialog" aria-label="Notifications">
        <div className="nx-notif-head">
          <span className="nx-notif-title">Notifications</span>
          <div style={{ display: "flex", gap: 8 }}>
            {notifications.length > 0 && (
              <button className="nx-btn nx-btn-secondary nx-btn-sm" onClick={markAllRead}>
                Mark all read
              </button>
            )}
            <button className="nx-notif-close" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        </div>
        <div className="nx-notif-list">
          {notifications.length === 0 && (
            <EmptyState
              icon="🔔"
              title="No notifications yet"
              description="Swap, liquidity, and faucet activity from this session will show up here as it happens."
            />
          )}
          {notifications.map((n) => (
            <div key={n.id} className={`nx-notif-item ${n.read ? "" : "nx-unread"}`}>
              <div className="nx-notif-icon">{KIND_ICON[n.kind] || "🔔"}</div>
              <div className="nx-notif-body">
                <div className="nx-notif-msg">{n.message}</div>
                <div className="nx-notif-meta">
                  <span>{timeAgo(n.time)}</span>
                  {n.txHash && (
                    <a
                      className="nx-notif-link"
                      href={`https://sepolia.etherscan.io/tx/${n.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View tx
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export default NotificationsPanel;
