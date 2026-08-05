import React from "react";
import Logo from "../nexora-logo-full.png";
import Sepolia from "../sepolia-badge.png";
import  { Link } from  "react-router-dom";

function Header({ connect, isConnected, address }) {

  function formatAddress(addr) {
    return addr.slice(0, 6) + "..." + addr.slice(-4);
  }

  return (
   <header>
    <div className="leftH">
      <img src={Logo}alt="logo" className="logo" />
      <Link to="/" className="link">
       <div className="headerItem">Swap</div>
      </Link>
      <Link to="/tokens" className="link">
       <div className="headerItem">Transactions</div>
      </Link>
      <Link to="/wrap" className="link">
       <div className="headerItem">Wrap</div>
      </Link>
      <Link to="/chart" className="link">
       <div className="headerItem">Chart</div>
      </Link>
      <Link to="/faucets" className="link">
       <div className="headerItem">Faucets</div>
      </Link>
      <Link to="/wallet" className="link">
       <div className="headerItem">Wallet</div>
      </Link>
      <Link to="/pool" className="link">
       <div className="headerItem">Pool</div>
      </Link>
    </div>
     <div className="rightH">
       <div className="headerItem">
         <img src={Sepolia} alt="sepolia" className="eth" />
         Sepolia
        </div>
       <div className="connectButton" onClick={connect}>
         {isConnected ? formatAddress(address) : "Connect"}
       </div>
     </div>
   </header>
  );
}

export default Header