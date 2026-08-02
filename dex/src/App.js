import "./App.css";
import CursorGlow from "./components/CursorGlow";
import Header from "./components/Header";
import Swap from "./components/Swap";
import Tokens from "./components/Tokens";
import WrapEth from "./components/WrapEth";
import Faucets from "./components/Faucets";
import Wallet from "./components/Wallet";
import Markets from "./components/Markets";
import AiAssistant from "./components/AiAssistant";
import  { Routes, Route} from  "react-router-dom";
import { useConnect, useAccount, useDisconnect } from "wagmi";
import { MetaMaskConnector } from "wagmi/connectors/metaMask";

function App() {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect({
    connector: new MetaMaskConnector(),
  });
  const { disconnect } = useDisconnect();

  return(
    <div className="App">
      <CursorGlow />
      <Header connect={connect} isConnected={isConnected} address={address} />
      <div className="mainWindow">
        <Routes>
          <Route path="/" element={<Swap isConnected={isConnected} address={address} />} />
           <Route path="/tokens" element={<Tokens isConnected={isConnected} address={address} />} />
           <Route path="/wrap" element={
             <div className="swapPageColumn">
               {isConnected ? (
                 <WrapEth isConnected={isConnected} address={address} />
               ) : (
                 <div className="tokensPage">
                   <div className="tokensEmpty">Connect your wallet to wrap or unwrap ETH.</div>
                 </div>
               )}
             </div>
           } />
           <Route path="/faucets" element={<Faucets />} />
           <Route path="/chart" element={<Markets />} />
           <Route path="/wallet" element={
             <Wallet isConnected={isConnected} address={address} disconnect={disconnect} />
           } />
           <Route path="/assistant" element={<AiAssistant />} />
        </Routes>
      </div>
    </div>
  ) 
  
}

export default App;