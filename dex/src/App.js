import "./App.css";
import { useEffect, useState } from "react";
import CursorGlow from "./components/CursorGlow";
import NexoraNavbar from "./components/NexoraNavbar";
import NexoraFooter from "./components/NexoraFooter";
import GlobalSearchOverlay from "./components/GlobalSearchOverlay";
import NotificationsPanel from "./components/NotificationsPanel";
import Home from "./components/Home";
import Swap from "./components/Swap";
import Tokens from "./components/Tokens";
import WrapEth from "./components/WrapEth";
import Faucets from "./components/Faucets";
import NexoraFaucet from "./components/NexoraFaucet";
import Wallet from "./components/Wallet";
import AnalyticsDashboard from "./components/AnalyticsDashboard";
import Markets from "./components/Markets";
import Pools from "./components/Pools";
import Portfolio from "./components/Portfolio";
import TokenExplorer from "./components/TokenExplorer";
import AddLiquidity from "./components/AddLiquidity";
import Zap from "./components/Zap";
import RoutePage from "./components/RoutePage";
import { Routes, Route } from "react-router-dom";
import { useConnect, useAccount, useDisconnect } from "wagmi";
import { MetaMaskConnector } from "wagmi/connectors/metaMask";
import { NotificationsProvider, useNotifications } from "./context/NotificationsContext";
import PageShell from "./components/ui/PageShell";
import EmptyState from "./components/ui/EmptyState";
import ThreeDBackground from "./components/ui/ThreeDBackground";

function AppShell() {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect({
    connector: new MetaMaskConnector(),
  });
  const { disconnect } = useDisconnect();
  const { unreadCount } = useNotifications();

  const [searchOpen, setSearchOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(e) {
      const isMeta = e.metaKey || e.ctrlKey;
      if (isMeta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === "Escape") {
        setSearchOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="App">
      <CursorGlow />
      <NexoraNavbar
        connect={connect}
        isConnected={isConnected}
        address={address}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenNotifications={() => setNotifOpen(true)}
        hasUnread={unreadCount > 0}
      />
      <div className="mainWindow">
        <Routes>
          <Route path="/" element={<Home isConnected={isConnected} address={address} />} />
          <Route path="/swap" element={<Swap isConnected={isConnected} address={address} />} />
          <Route path="/tokens" element={<Tokens isConnected={isConnected} address={address} />} />
          <Route
            path="/wrap"
            element={
              <div className="swapPageColumn">
                {isConnected ? (
                  <WrapEth isConnected={isConnected} address={address} />
                ) : (
                  <PageShell
                    eyebrow="Fast Action"
                    title="Wrap ETH"
                    subtitle="Connect your wallet to wrap or unwrap Sepolia ETH."
                    background={<ThreeDBackground intensity={3} />}
                  >
                    <EmptyState
                      icon="👛"
                      title="Wallet not connected"
                      description="Connect MetaMask (top right) to wrap or unwrap ETH."
                    />
                  </PageShell>
                )}
              </div>
            }
          />
          <Route path="/faucets" element={<Faucets />} />
          <Route
            path="/nexora-faucet"
            element={<NexoraFaucet isConnected={isConnected} address={address} connect={connect} />}
          />
          <Route path="/chart" element={<AnalyticsDashboard />} />
          <Route path="/markets" element={<Markets />} />
          <Route path="/pools" element={<Pools />} />
          <Route path="/portfolio" element={<Portfolio isConnected={isConnected} address={address} />} />
          <Route path="/explorer" element={<TokenExplorer />} />
          <Route path="/explorer/:symbol" element={<TokenExplorer />} />
          <Route path="/add-liquidity" element={<AddLiquidity isConnected={isConnected} address={address} />} />
          <Route path="/zap" element={<Zap />} />
          <Route path="/route" element={<RoutePage />} />
          <Route
            path="/wallet"
            element={<Wallet isConnected={isConnected} address={address} disconnect={disconnect} />}
          />
        </Routes>
      </div>
      <NexoraFooter />

      {searchOpen && <GlobalSearchOverlay onClose={() => setSearchOpen(false)} />}
      {notifOpen && <NotificationsPanel onClose={() => setNotifOpen(false)} />}
    </div>
  );
}

function App() {
  return (
    <NotificationsProvider>
      <AppShell />
    </NotificationsProvider>
  );
}

export default App;
