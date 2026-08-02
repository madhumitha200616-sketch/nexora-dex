import React, { useState, useRef, useEffect } from 'react'
import axios from "axios";
import { RobotOutlined, SendOutlined, WarningOutlined, BulbOutlined, UserOutlined } from "@ant-design/icons";
import { handleTiltMove, handleTiltLeave } from "../tiltEffect";
import { API_BASE_URL } from "../apiConfig";

// Real answers come from the backend's /askAI route, which proxies to
// Google Gemini (gemini-2.5-flash, free tier) using a server-side key - see
// dexBack/index.js and dexBack/.env (GEMINI_API_KEY). Each mode below sends
// its own "mode" so the backend picks a different system prompt (general
// assistant / error explainer / swap advisor) while reusing one endpoint.
//
// This local, keyword-matched FAQ is kept as a FALLBACK only for the
// Blockchain Assistant tab: if the backend isn't running, the key isn't
// configured, or the request just fails, the chat still answers something
// useful instead of going blank - and is clearly tagged "offline" when it
// does. The other two tabs need a live model to do their job, so they show
// a plain "try again" message instead of guessing.
//
// Order matters: more specific terms (WETH) are checked before the shorter
// terms they contain (ETH), so "what is weth" doesn't accidentally match
// the ETH entry first.
const KNOWLEDGE_BASE = [
  {
    keywords: ["weth", "wrapped eth", "wrapped ethereum"],
    answer:
      "WETH (Wrapped Ethereum) is plain ETH converted 1:1 into an ERC-20 token, so it can be approved, transferred, " +
      "and swapped like any other token in a pool. There's no price difference - 1 WETH is always worth exactly 1 " +
      "ETH. Use the Wrap page here to convert between them any time.",
  },
  {
    keywords: ["usdc", "usd coin"],
    answer:
      "USDC (USD Coin) is a stablecoin - a token designed to always be worth about $1, backed 1:1 by real dollar " +
      "reserves. It's used here as the \"stable\" side of the WETH/USDC pair so you can swap volatile ETH for " +
      "something price-stable.",
  },
  {
    keywords: ["link", "chainlink"],
    answer:
      "LINK is Chainlink's native token. Chainlink runs decentralized \"oracle\" networks that feed real-world data " +
      "(like prices) onto the blockchain, since smart contracts can't fetch external data themselves - LINK is how " +
      "node operators get paid for providing that data reliably.",
  },
  {
    keywords: ["eth", "ethereum"],
    answer:
      "ETH (Ether) is Ethereum's native currency - it pays for gas (transaction fees) and is the base asset the " +
      "network runs on. On this app you're using Sepolia ETH, a free testnet version with no real value, purely " +
      "for practicing swaps safely.",
  },
  {
    keywords: ["gas fee", "gas", "transaction fee"],
    answer:
      "A gas fee is what you pay validators to process your transaction on-chain. It's paid in ETH regardless of " +
      "which tokens you're swapping, and the amount depends on how much computation your transaction needs plus " +
      "current network demand. The Swap page shows a live estimate before you confirm.",
  },
  {
    keywords: ["slippage"],
    answer:
      "Slippage tolerance is the maximum amount the price is allowed to move against you between requesting a " +
      "swap and it actually confirming on-chain. If the price moves more than that, the transaction automatically " +
      "cancels instead of giving you a worse rate than you agreed to - you only lose the gas fee, not your funds.",
  },
  {
    keywords: ["blockchain"],
    answer:
      "A blockchain is a shared, public ledger maintained by many independent computers (nodes) instead of one " +
      "central authority. Every transaction is verified and permanently recorded, and no single person or company " +
      "can alter past records or block someone else's transaction.",
  },
  {
    keywords: ["metamask"],
    answer:
      "MetaMask is a browser/mobile wallet that stores your private keys and lets websites like this one request " +
      "your permission to read your address or sign transactions - it never hands over your keys, every action " +
      "needs your explicit approval in its popup.",
  },
  {
    keywords: ["sepolia", "testnet"],
    answer:
      "Sepolia is Ethereum's official test network - functionally identical to mainnet, but all tokens are free " +
      "and worthless. Developers use it to build and test apps like this one without risking real money.",
  },
  {
    keywords: ["router"],
    answer:
      "The router is the smart contract you actually send a swap transaction to. It doesn't hold your funds - it " +
      "pulls your input token straight into the liquidity pool, the pool sends the output token straight to the " +
      "recipient, and the router just checks the result matches what you agreed to (price, minimum received).",
  },
  {
    keywords: ["liquidity pool", "liquidity", "pool"],
    answer:
      "A liquidity pool is a shared reserve of two tokens that trades are made against, instead of matching " +
      "individual buyers and sellers. Prices move based on the pool's own ratio of the two tokens as people trade. " +
      "No pool for a given pair means no way to swap it here.",
  },
  {
    keywords: ["why did my transaction fail", "transaction failed", "swap failed", "why did my swap fail"],
    answer:
      "The most common reasons: insufficient balance for the amount (or for gas), the price moved past your " +
      "slippage tolerance before confirming, or there's no liquidity pool for the pair you picked. This app shows " +
      "a specific reason for each of those instead of a generic \"failed\" message.",
  },
  {
    keywords: ["how do i swap", "how to swap"],
    answer:
      "Connect your wallet, pick the token you're paying with and the one you want, enter an amount, hit \"Review " +
      "Swap\" to see the exact quote and minimum you'll receive, then \"Confirm Swap\" to sign it in MetaMask. " +
      "Only WETH ⇄ USDC has real liquidity on this testnet right now.",
  },
  {
    keywords: ["recipient", "wallet address"],
    answer:
      "By default, swap output goes back to your own connected wallet, but the \"Send output to\" field lets you " +
      "redirect it to any address. The app blocks the zero address and contract addresses automatically, since " +
      "tokens sent to the wrong place can be unrecoverable.",
  },
];

const FALLBACK_ANSWER =
  "The AI service is unreachable right now, so here's what my small offline FAQ knows - try one of the " +
  "suggestions, or ask about tokens (ETH/WETH/USDC/LINK), gas fees, slippage, blockchain, MetaMask, Sepolia, " +
  "liquidity pools, or why a swap might fail.";

function matchAnswer(question) {
  const q = question.toLowerCase();
  for (const entry of KNOWLEDGE_BASE) {
    if (entry.keywords.some((kw) => q.includes(kw))) {
      return entry.answer;
    }
  }
  return FALLBACK_ANSWER;
}

const OFFLINE_RETRY_MESSAGE =
  "The AI service is unreachable right now, so I can't do this properly offline. Make sure the backend is " +
  "running and GEMINI_API_KEY is set in dexBack/.env, then try again.";

// Three tabs, one shared chat UI. "mode" is sent to the backend so it can
// swap in a different system prompt per tab, while the frontend just needs
// different copy, suggestions, and (for the general assistant only) a local
// FAQ fallback.
const MODES = [
  {
    key: "assistant",
    label: "Blockchain Assistant",
    icon: RobotOutlined,
    subtitle: "Ask anything about this app, blockchain, or DeFi - powered by Google Gemini",
    greeting:
      "Hi, I'm the Nexora Blockchain Assistant, powered by Google Gemini - ask me anything about this app, " +
      "blockchain, or DeFi in general. If the AI service is ever unreachable, I'll fall back to a small offline " +
      "FAQ instead of leaving you hanging.",
    placeholder: "Ask me anything...",
    suggestions: [
      "What is ETH?",
      "What is WETH?",
      "What is USDC?",
      "What is LINK?",
      "Explain gas fees.",
      "Explain slippage.",
      "What is blockchain?",
      "What is MetaMask?",
      "What is Sepolia?",
      "How do I swap?",
    ],
  },
  {
    key: "error",
    label: "Error Explanation",
    icon: WarningOutlined,
    subtitle: "Paste any wallet, swap, or console error for a plain-English breakdown",
    greeting:
      "Paste any error you hit here - a MetaMask popup, a console message, or a failed-transaction reason - " +
      "and I'll explain what it means, why it likely happened, and how to fix it.",
    placeholder: "Paste the error message here...",
    suggestions: [
      "execution reverted: STF",
      "insufficient funds for gas",
      "user rejected the transaction",
      "no liquidity pool found for this pair",
      "nonce too low",
      "MetaMask - Internal JSON-RPC error",
    ],
  },
  {
    key: "advisor",
    label: "Swap Advisor",
    icon: BulbOutlined,
    subtitle: "Educational guidance on your swap setup - not financial advice",
    greeting:
      "Tell me about a swap you're planning - the token pair, amount, and slippage tolerance - and I'll flag " +
      "anything worth double-checking before you hit Review Swap. This is educational guidance only, not " +
      "financial advice.",
    placeholder: "e.g. Swapping 0.5 WETH to USDC with 1% slippage - is that OK?",
    suggestions: [
      "I want to swap 0.5 WETH to USDC with 1% slippage - is that safe?",
      "What slippage should I use for a stablecoin pair?",
      "Is a 5% price impact normal?",
      "Should I split a large swap into smaller ones?",
      "Is it safe to send output to a different wallet address?",
    ],
  },
];

function AiAssistant() {
  const [modeKey, setModeKey] = useState("assistant");
  const [messagesByMode, setMessagesByMode] = useState(() =>
    Object.fromEntries(MODES.map((m) => [m.key, [{ role: "ai", text: m.greeting }]]))
  );
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const scrollRef = useRef(null);

  const mode = MODES.find((m) => m.key === modeKey);
  const messages = messagesByMode[modeKey];

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isThinking]);

  async function send(text) {
    const question = text.trim();
    if (!question || isThinking) return;

    const activeMode = modeKey;
    const priorMessages = messagesByMode[activeMode];

    setMessagesByMode((prev) => ({
      ...prev,
      [activeMode]: [...prev[activeMode], { role: "user", text: question }],
    }));
    setInput("");
    setIsThinking(true);

    try {
      // A short window of prior turns from this tab only, so follow-up
      // questions ("what about the second one?") keep context instead of
      // the assistant treating every message as a cold start.
      const history = priorMessages
        .filter((m) => m.role === "user" || m.role === "ai")
        .slice(-6)
        .map((m) => ({ role: m.role === "ai" ? "assistant" : "user", content: m.text }));

      const res = await axios.post(
        `${API_BASE_URL}/askAI`,
        { question, history, mode: activeMode },
        { timeout: 32000 }
      );
      setMessagesByMode((prev) => ({
        ...prev,
        [activeMode]: [...prev[activeMode], { role: "ai", text: res.data.answer }],
      }));
    } catch (err) {
      console.error("AI Assistant request failed, falling back:", err);
      // Backend not running, no GEMINI_API_KEY configured, or a network
      // hiccup. The general assistant has a local FAQ to fall back on;
      // error/advisor modes genuinely need a live model, so they just say so.
      const fallbackText = activeMode === "assistant" ? matchAnswer(question) : OFFLINE_RETRY_MESSAGE;
      setMessagesByMode((prev) => ({
        ...prev,
        [activeMode]: [...prev[activeMode], { role: "ai", text: fallbackText, offline: true }],
      }));
    } finally {
      setIsThinking(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    send(input);
  }

  const Icon = mode.icon;

  return (
    <div className="swapPageColumn">
      <div className="wrapTabs aiModeTabs">
        {MODES.map((m) => {
          const TabIcon = m.icon;
          return (
            <span
              key={m.key}
              className={m.key === modeKey ? "wrapTab aiModeTab wrapTabActive" : "wrapTab aiModeTab"}
              onClick={() => setModeKey(m.key)}
            >
              <TabIcon className="aiModeTabIcon" />
              {m.label}
            </span>
          );
        })}
      </div>

      <div
        className="aiChatBox"
        onMouseMove={(e) => handleTiltMove(e, 2)}
        onMouseLeave={handleTiltLeave}
      >
        <div className="aiChatHeader">
          <div className="aiChatHeaderIconWrap">
            <Icon className="aiChatHeaderIcon" />
          </div>
          <div>
            <h4>Nexora {mode.label}</h4>
            <span className="aiSubtitle">{mode.subtitle}</span>
          </div>
        </div>

        {modeKey === "advisor" && (
          <div className="aiDisclaimer">Educational guidance only - not financial advice.</div>
        )}

        <div className="aiChatMessages" ref={scrollRef}>
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "aiMsgRow aiMsgRowUser" : "aiMsgRow"}>
              {m.role !== "user" && (
                <div className="aiMsgAvatar">
                  <Icon />
                </div>
              )}
              <div className={m.role === "user" ? "aiMsgBubble aiMsgBubbleUser" : "aiMsgBubble"}>
                {m.offline && <div className="aiOfflineTag">Offline</div>}
                {m.text}
              </div>
              {m.role === "user" && (
                <div className="aiMsgAvatar aiMsgAvatarUser">
                  <UserOutlined />
                </div>
              )}
            </div>
          ))}
          {isThinking && (
            <div className="aiMsgRow">
              <div className="aiMsgAvatar">
                <Icon />
              </div>
              <div className="aiMsgBubble aiTypingBubble">
                <span className="aiTypingDot"></span>
                <span className="aiTypingDot"></span>
                <span className="aiTypingDot"></span>
              </div>
            </div>
          )}
        </div>

        <div className="aiSuggestions">
          {mode.suggestions.map((s) => (
            <span key={s} className="aiSuggestionChip" onClick={() => send(s)}>
              {s}
            </span>
          ))}
        </div>

        <form className="aiChatInputRow" onSubmit={handleSubmit}>
          <input
            className="aiChatInput"
            placeholder={mode.placeholder}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button type="submit" className="aiChatSendBtn" disabled={!input.trim() || isThinking}>
            <SendOutlined />
          </button>
        </form>
      </div>
    </div>
  );
}

export default AiAssistant
