import { useEffect, useMemo, useRef, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import {
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { auth, db } from "./firebase";

const STATUS_LABELS = {
  waiting_support: "User yazdi",
  waiting_user: "Destek yazdi",
  closed: "Kapali",
};

const REFUND_STATUS_LABELS = {
  pending_review: "Bekliyor",
  reviewed: "Incelendi",
};

const SUPPORT_ALLOWED_EMAILS = (import.meta.env.VITE_SUPPORT_ALLOWED_EMAILS || "")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

const OPERATOR_NAME_STORAGE_KEY = "smsx_support_operator_name";
const APP_TITLE = "SMSX Admin";
const CLOSED_CHAT_STATUS = "closed";
const CRYPTO_SUCCESS_STATUSES = new Set(["finished", "confirmed"]);
const MOBILE_BREAKPOINT = 980;

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard" },
  { id: "chats", label: "Sohbetler", icon: "chat" },
  { id: "refunds", label: "Refundlar", icon: "refund" },
  { id: "sales", label: "Satislar", icon: "sales" },
  { id: "crypto", label: "Kripto", icon: "crypto" },
  { id: "devices", label: "Cihazlar", icon: "devices" },
];

function App() {
  const [user, setUser] = useState(null);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth <= MOBILE_BREAKPOINT : false
  );
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("dashboard");
  const [searchQuery, setSearchQuery] = useState("");
  const [loginForm, setLoginForm] = useState({
    name: localStorage.getItem(OPERATOR_NAME_STORAGE_KEY) || "",
    email: "",
    password: "",
  });
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [threads, setThreads] = useState([]);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isUpdatingThread, setIsUpdatingThread] = useState(false);
  const [selectedThreadId, setSelectedThreadId] = useState("");
  const [chatFilter, setChatFilter] = useState("open");
  const [chatMobileStage, setChatMobileStage] = useState("list");

  const [refunds, setRefunds] = useState([]);
  const [selectedRefundId, setSelectedRefundId] = useState("");
  const [refundFilter, setRefundFilter] = useState("pending");
  const [refundMobileStage, setRefundMobileStage] = useState("list");
  const [isUpdatingRefund, setIsUpdatingRefund] = useState(false);

  const [purchases, setPurchases] = useState([]);
  const [selectedPurchaseId, setSelectedPurchaseId] = useState("");
  const [salesMobileStage, setSalesMobileStage] = useState("list");

  const [cryptoPayments, setCryptoPayments] = useState([]);
  const [selectedCryptoId, setSelectedCryptoId] = useState("");
  const [cryptoMobileStage, setCryptoMobileStage] = useState("list");

  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [devicesMobileStage, setDevicesMobileStage] = useState("list");

  const [notificationPermission, setNotificationPermission] = useState(getNotificationPermission());

  const messagesEndRef = useRef(null);
  const hasInitializedThreadsRef = useRef(false);
  const previousThreadStateRef = useRef(new Map());

  const operatorName = useMemo(() => {
    const trimmedName = loginForm.name.trim();
    if (trimmedName) {
      return trimmedName;
    }

    return localStorage.getItem(OPERATOR_NAME_STORAGE_KEY) || user?.email || "Destek";
  }, [loginForm.name, user]);

  useEffect(() => {
    const onResize = () => {
      const nextIsMobile = window.innerWidth <= MOBILE_BREAKPOINT;
      setIsMobile(nextIsMobile);
      if (!nextIsMobile) {
        setIsSidebarOpen(false);
      }
    };

    if (typeof window !== "undefined") {
      window.addEventListener("resize", onResize);
    }

    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("resize", onResize);
      }
    };
  }, []);

  useEffect(() => {
    setPersistence(auth, browserLocalPersistence).catch(() => {});

    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      if (nextUser && SUPPORT_ALLOWED_EMAILS.length > 0) {
        const normalizedEmail = (nextUser.email || "").trim().toLowerCase();
        if (!SUPPORT_ALLOWED_EMAILS.includes(normalizedEmail)) {
          await signOut(auth);
          setErrorMessage("Bu hesap yetkili degil.");
          return;
        }
      }

      setUser(nextUser);
      setErrorMessage("");
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user) {
      setThreads([]);
      return undefined;
    }

    return onSnapshot(
      query(collection(db, "supportThreads"), orderBy("updatedAt", "desc")),
      (snapshot) => {
        setThreads(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      },
      (error) => setErrorMessage(error.message)
    );
  }, [user]);

  useEffect(() => {
    if (!user) {
      setRefunds([]);
      return undefined;
    }

    return onSnapshot(
      query(collection(db, "refundEvents"), orderBy("eventTimestamp", "desc")),
      (snapshot) => {
        setRefunds(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      },
      (error) => setErrorMessage(error.message)
    );
  }, [user]);

  useEffect(() => {
    if (!user) {
      setPurchases([]);
      return undefined;
    }

    return onSnapshot(
      query(collection(db, "purchases"), orderBy("updatedAt", "desc")),
      (snapshot) => {
        setPurchases(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      },
      (error) => setErrorMessage(error.message)
    );
  }, [user]);

  useEffect(() => {
    if (!user) {
      setCryptoPayments([]);
      return undefined;
    }

    return onSnapshot(
      query(collection(db, "cryptoPayments"), orderBy("updatedAt", "desc")),
      (snapshot) => {
        setCryptoPayments(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      },
      (error) => setErrorMessage(error.message)
    );
  }, [user]);

  useEffect(() => {
    if (!user) {
      setDevices([]);
      return undefined;
    }

    return onSnapshot(
      query(collection(db, "devices"), orderBy("updatedAt", "desc")),
      (snapshot) => {
        setDevices(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      },
      (error) => setErrorMessage(error.message)
    );
  }, [user]);

  useEffect(() => {
    if (!selectedThreadId) {
      setMessages([]);
      return undefined;
    }

    return onSnapshot(
      query(collection(db, "supportThreads", selectedThreadId, "messages"), orderBy("createdAt", "asc")),
      (snapshot) => {
        setMessages(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      },
      (error) => setErrorMessage(error.message)
    );
  }, [selectedThreadId]);

  const totalUnreadSupport = useMemo(
    () => threads.reduce((sum, thread) => sum + safeNumber(thread.unreadBySupport), 0),
    [threads]
  );

  const pendingRefundCount = useMemo(
    () => refunds.reduce((sum, refund) => sum + (refund.reviewed ? 0 : 1), 0),
    [refunds]
  );

  useEffect(() => {
    const badgeCount = totalUnreadSupport + pendingRefundCount;
    document.title = badgeCount > 0 ? `(${badgeCount}) ${APP_TITLE}` : APP_TITLE;

    return () => {
      document.title = APP_TITLE;
    };
  }, [pendingRefundCount, totalUnreadSupport]);

  useEffect(() => {
    if (!user) {
      previousThreadStateRef.current = new Map();
      hasInitializedThreadsRef.current = false;
      return;
    }

    const nextSnapshot = new Map(
      threads.map((thread) => [
        thread.id,
        {
          unreadBySupport: safeNumber(thread.unreadBySupport),
          lastMessageSenderType: thread.lastMessageSenderType || "",
          lastMessageAt: timestampValue(thread.lastMessageAt || thread.updatedAt || thread.createdAt),
          subject: thread.subject || "Destek",
          lastMessageText: thread.lastMessageText || "",
        },
      ])
    );

    if (!hasInitializedThreadsRef.current) {
      previousThreadStateRef.current = nextSnapshot;
      hasInitializedThreadsRef.current = true;
      return;
    }

    if (notificationPermission === "granted") {
      threads.forEach((thread) => {
        const previous = previousThreadStateRef.current.get(thread.id);
        const currentUnread = safeNumber(thread.unreadBySupport);
        const currentTimestamp = timestampValue(thread.lastMessageAt || thread.updatedAt || thread.createdAt);
        const isUserMessage = thread.lastMessageSenderType === "user";
        const isNewUnread = currentUnread > (previous?.unreadBySupport || 0);
        const isNewerEvent = currentTimestamp > (previous?.lastMessageAt || 0);
        const isNewThread = !previous && currentUnread > 0;
        const shouldNotify = isUserMessage && (isNewThread || (isNewUnread && isNewerEvent));

        if (!shouldNotify) {
          return;
        }

        const isCurrentlyOpen =
          activeSection === "chats" &&
          selectedThreadId === thread.id &&
          typeof document !== "undefined" &&
          document.visibilityState === "visible";

        if (isCurrentlyOpen) {
          return;
        }

        showIncomingSupportNotification({
          threadId: thread.id,
          subject: thread.subject || "Destek",
          message: thread.lastMessageText || "Yeni mesaj var.",
          onOpen: () => {
            if (typeof window !== "undefined") {
              window.focus();
            }
            setActiveSection("chats");
            setSelectedThreadId(thread.id);
            setChatMobileStage("detail");
          },
        });
      });
    }

    previousThreadStateRef.current = nextSnapshot;
  }, [activeSection, notificationPermission, selectedThreadId, threads, user]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  useEffect(() => {
    if (!selectedThreadId) {
      return;
    }

    updateDoc(doc(db, "supportThreads", selectedThreadId), {
      unreadBySupport: 0,
    }).catch(() => {});
  }, [selectedThreadId]);

  useEffect(() => {
    if (isMobile) {
      setChatMobileStage("list");
      setRefundMobileStage("list");
      setSalesMobileStage("list");
      setCryptoMobileStage("list");
      setDevicesMobileStage("list");
    }
  }, [activeSection, isMobile]);

  const normalizedSearch = normalize(searchQuery);

  const filteredThreads = useMemo(() => {
    const base =
      chatFilter === "all"
        ? threads
        : chatFilter === "closed"
          ? threads.filter((thread) => thread.status === CLOSED_CHAT_STATUS)
          : threads.filter((thread) => thread.status !== CLOSED_CHAT_STATUS);

    if (!normalizedSearch) {
      return base;
    }

    return base.filter((thread) =>
      matchesQuery(normalizedSearch, [
        thread.subject,
        thread.deviceId,
        thread.authUid,
        thread.lastMessageText,
        thread.assignedOperatorName,
      ])
    );
  }, [chatFilter, normalizedSearch, threads]);

  const filteredRefunds = useMemo(() => {
    const base =
      refundFilter === "all"
        ? refunds
        : refundFilter === "reviewed"
          ? refunds.filter((refund) => refund.reviewed)
          : refunds.filter((refund) => !refund.reviewed);

    if (!normalizedSearch) {
      return base;
    }

    return base.filter((refund) =>
      matchesQuery(normalizedSearch, [
        refund.deviceId,
        refund.appUserId,
        refund.productId,
        refund.transactionId,
        refund.originalTransactionId,
        refund.eventType,
      ])
    );
  }, [normalizedSearch, refundFilter, refunds]);

  const filteredPurchases = useMemo(() => {
    if (!normalizedSearch) {
      return purchases;
    }

    return purchases.filter((purchase) =>
      matchesQuery(normalizedSearch, [
        purchase.deviceId,
        purchase.productId,
        purchase.transactionId,
        purchase.originalTransactionId,
        purchase.store,
        purchase.source,
      ])
    );
  }, [normalizedSearch, purchases]);

  const filteredCryptoPayments = useMemo(() => {
    if (!normalizedSearch) {
      return cryptoPayments;
    }

    return cryptoPayments.filter((payment) =>
      matchesQuery(normalizedSearch, [
        payment.orderId,
        payment.deviceId,
        payment.productId,
        payment.status,
        payment.providerInvoiceId,
        payment.providerPaymentId,
      ])
    );
  }, [cryptoPayments, normalizedSearch]);

  const filteredDevices = useMemo(() => {
    if (!normalizedSearch) {
      return devices;
    }

    return devices.filter((device) =>
      matchesQuery(normalizedSearch, [
        device.deviceId,
        device.mail,
        device.appleUserID,
        device.referralCode,
        device.banReason,
      ])
    );
  }, [devices, normalizedSearch]);

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedThreadId) || null,
    [selectedThreadId, threads]
  );

  const selectedRefund = useMemo(
    () => refunds.find((refund) => refund.id === selectedRefundId) || null,
    [refunds, selectedRefundId]
  );

  const selectedPurchase = useMemo(
    () => purchases.find((purchase) => purchase.id === selectedPurchaseId) || null,
    [purchases, selectedPurchaseId]
  );

  const selectedCryptoPayment = useMemo(
    () => cryptoPayments.find((payment) => payment.id === selectedCryptoId) || null,
    [cryptoPayments, selectedCryptoId]
  );

  const selectedDevice = useMemo(
    () =>
      devices.find((device) => (device.deviceId || device.id) === selectedDeviceId) || null,
    [devices, selectedDeviceId]
  );

  const selectedThreadDevice = useMemo(() => {
    if (!selectedThread) {
      return null;
    }

    return devices.find((item) => (item.deviceId || item.id) === selectedThread.deviceId) || null;
  }, [devices, selectedThread]);

  useEffect(() => {
    if (!filteredThreads.length) {
      setSelectedThreadId("");
      return;
    }

    if (!selectedThreadId || !filteredThreads.some((thread) => thread.id === selectedThreadId)) {
      setSelectedThreadId(filteredThreads[0].id);
    }
  }, [filteredThreads, selectedThreadId]);

  useEffect(() => {
    if (!filteredRefunds.length) {
      setSelectedRefundId("");
      return;
    }

    if (!selectedRefundId || !filteredRefunds.some((refund) => refund.id === selectedRefundId)) {
      setSelectedRefundId(filteredRefunds[0].id);
    }
  }, [filteredRefunds, selectedRefundId]);

  useEffect(() => {
    if (!filteredPurchases.length) {
      setSelectedPurchaseId("");
      return;
    }

    if (!selectedPurchaseId || !filteredPurchases.some((purchase) => purchase.id === selectedPurchaseId)) {
      setSelectedPurchaseId(filteredPurchases[0].id);
    }
  }, [filteredPurchases, selectedPurchaseId]);

  useEffect(() => {
    if (!filteredCryptoPayments.length) {
      setSelectedCryptoId("");
      return;
    }

    if (!selectedCryptoId || !filteredCryptoPayments.some((payment) => payment.id === selectedCryptoId)) {
      setSelectedCryptoId(filteredCryptoPayments[0].id);
    }
  }, [filteredCryptoPayments, selectedCryptoId]);

  useEffect(() => {
    if (!filteredDevices.length) {
      setSelectedDeviceId("");
      return;
    }

    if (!selectedDeviceId || !filteredDevices.some((device) => (device.deviceId || device.id) === selectedDeviceId)) {
      setSelectedDeviceId(filteredDevices[0].deviceId || filteredDevices[0].id);
    }
  }, [filteredDevices, selectedDeviceId]);

  const dashboardMetrics = useMemo(() => buildDashboardMetrics({
    threads,
    refunds,
    purchases,
    cryptoPayments,
    devices,
  }), [threads, refunds, purchases, cryptoPayments, devices]);

  const weeklySales = useMemo(() => buildWeeklySales(purchases), [purchases]);
  const recentSales = useMemo(() => purchases.slice(0, 7), [purchases]);
  const recentChats = useMemo(() => threads.filter((thread) => thread.status !== CLOSED_CHAT_STATUS).slice(0, 6), [threads]);
  const recentRefunds = useMemo(() => refunds.filter((refund) => !refund.reviewed).slice(0, 6), [refunds]);
  const recentCrypto = useMemo(() => cryptoPayments.slice(0, 6), [cryptoPayments]);
  const recentDevices = useMemo(() => devices.slice(0, 6), [devices]);

  async function enableBrowserNotifications() {
    if (typeof window === "undefined" || typeof Notification === "undefined") {
      setErrorMessage("Bu tarayici bildirim desteklemiyor.");
      setNotificationPermission("unsupported");
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      if (permission !== "granted") {
        setErrorMessage("Tarayici bildirimi acilmadi.");
      } else {
        setErrorMessage("");
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleLogin(event) {
    event.preventDefault();

    const normalizedName = loginForm.name.trim();
    if (!normalizedName) {
      setErrorMessage("Operator adi gir.");
      return;
    }

    setIsLoggingIn(true);
    setErrorMessage("");

    try {
      localStorage.setItem(OPERATOR_NAME_STORAGE_KEY, normalizedName);
      await signInWithEmailAndPassword(auth, loginForm.email, loginForm.password);
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setIsLoggingIn(false);
    }
  }

  async function handleLogout() {
    await signOut(auth);
  }

  function switchSection(sectionId) {
    setActiveSection(sectionId);
    setIsSidebarOpen(false);
  }

  async function assignToMe() {
    if (!selectedThread || !user) return;

    setIsUpdatingThread(true);
    setErrorMessage("");

    try {
      await updateDoc(doc(db, "supportThreads", selectedThread.id), {
        assignedOperatorId: user.uid,
        assignedOperatorName: operatorName,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setIsUpdatingThread(false);
    }
  }

  async function updateThreadStatus(nextStatus) {
    if (!selectedThread || !user) return;

    setIsUpdatingThread(true);
    setErrorMessage("");

    try {
      await updateDoc(doc(db, "supportThreads", selectedThread.id), {
        status: nextStatus,
        closedAt: nextStatus === CLOSED_CHAT_STATUS ? serverTimestamp() : null,
        updatedAt: serverTimestamp(),
        assignedOperatorId: selectedThread.assignedOperatorId || user.uid,
        assignedOperatorName: selectedThread.assignedOperatorName || operatorName,
      });

      await addDoc(collection(db, "supportThreads", selectedThread.id, "events"), {
        type: nextStatus === CLOSED_CHAT_STATUS ? "closed" : "reopened",
        actorType: "support",
        actorId: user.uid,
        value: nextStatus,
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setIsUpdatingThread(false);
    }
  }

  async function sendMessage(event) {
    event.preventDefault();

    if (!selectedThread || !user || !draft.trim()) return;

    setIsSending(true);
    setErrorMessage("");

    try {
      const normalizedText = draft.trim();
      const threadRef = doc(db, "supportThreads", selectedThread.id);

      await addDoc(collection(db, "supportThreads", selectedThread.id, "messages"), {
        threadId: selectedThread.id,
        senderType: "support",
        senderId: user.uid,
        senderName: operatorName,
        text: normalizedText,
        createdAt: serverTimestamp(),
        isInternal: false,
      });

      await setDoc(
        threadRef,
        {
          status: "waiting_user",
          lastMessageText: normalizedText,
          lastMessageSenderType: "support",
          lastMessageAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          unreadByUser: safeNumber(selectedThread.unreadByUser) + 1,
          unreadBySupport: 0,
          assignedOperatorId: selectedThread.assignedOperatorId || user.uid,
          assignedOperatorName: selectedThread.assignedOperatorName || operatorName,
        },
        { merge: true }
      );

      setDraft("");
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setIsSending(false);
    }
  }

  async function markRefundReviewed() {
    if (!selectedRefund || !user || selectedRefund.reviewed) return;

    setIsUpdatingRefund(true);
    setErrorMessage("");

    try {
      await updateDoc(doc(db, "refundEvents", selectedRefund.id), {
        reviewed: true,
        status: "reviewed",
        reviewedAt: serverTimestamp(),
        reviewedBy: user.uid,
        reviewedByName: operatorName,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setIsUpdatingRefund(false);
    }
  }

  if (!user) {
    return (
      <div className="login-shell">
        <form className="login-card" onSubmit={handleLogin}>
          <div className="login-brand">
            <span className="brand-mark">S</span>
            <span>SMSX Admin</span>
          </div>
          <h1>Giris</h1>

          <label>
            <span>Operator</span>
            <input
              type="text"
              value={loginForm.name}
              onChange={(event) =>
                setLoginForm((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="Mina"
              autoComplete="name"
            />
          </label>

          <label>
            <span>Email</span>
            <input
              type="email"
              value={loginForm.email}
              onChange={(event) =>
                setLoginForm((current) => ({ ...current, email: event.target.value }))
              }
              placeholder="support@smsx.co"
              autoComplete="email"
            />
          </label>

          <label>
            <span>Sifre</span>
            <input
              type="password"
              value={loginForm.password}
              onChange={(event) =>
                setLoginForm((current) => ({ ...current, password: event.target.value }))
              }
              placeholder="******"
              autoComplete="current-password"
            />
          </label>

          {errorMessage ? <div className="inline-alert">{errorMessage}</div> : null}

          <button className="primary-button" type="submit" disabled={isLoggingIn}>
            {isLoggingIn ? "Giris..." : "Giris yap"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="shell">
      <aside className={`sidebar ${isSidebarOpen ? "open" : ""}`}>
        <div className="sidebar-head">
          <div className="brand-lockup">
            <span className="brand-mark">S</span>
            <div>
              <strong>SMSX</strong>
              <span>Admin</span>
            </div>
          </div>

          <button
            type="button"
            className="icon-button only-mobile"
            onClick={() => setIsSidebarOpen(false)}
            aria-label="Menüyü kapat"
          >
            <AppIcon name="close" />
          </button>
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nav-item ${activeSection === item.id ? "active" : ""}`}
              onClick={() => switchSection(item.id)}
            >
              <span className="nav-icon">
                <AppIcon name={item.icon} />
              </span>
              <span>{item.label}</span>
              <span className="nav-badge">
                {item.id === "chats"
                  ? totalUnreadSupport || ""
                  : item.id === "refunds"
                    ? pendingRefundCount || ""
                    : ""}
              </span>
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="operator-tile">
            <strong>{operatorName}</strong>
            <span>{user.email}</span>
          </div>
          <button className="ghost-button full-width" type="button" onClick={handleLogout}>
            Cikis yap
          </button>
        </div>
      </aside>

      {isSidebarOpen ? <button className="sidebar-backdrop" type="button" onClick={() => setIsSidebarOpen(false)} /> : null}

      <main className="main">
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="icon-button only-mobile"
              onClick={() => setIsSidebarOpen(true)}
              aria-label="Menüyü aç"
            >
              <AppIcon name="menu" />
            </button>
            <div className="topbar-copy">
              <h1>{sectionTitle(activeSection)}</h1>
              <span>{sectionMeta(activeSection, dashboardMetrics)}</span>
            </div>
          </div>

          <div className="topbar-right">
            <div className="search-shell">
              <AppIcon name="search" />
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Ara"
              />
            </div>
            {notificationPermission !== "granted" ? (
              <button className="ghost-button compact-button" type="button" onClick={enableBrowserNotifications}>
                Bildirim
              </button>
            ) : null}
          </div>
        </header>

        {errorMessage ? <div className="inline-alert page-alert">{errorMessage}</div> : null}

        {activeSection === "dashboard" ? (
          <DashboardSection
            metrics={dashboardMetrics}
            weeklySales={weeklySales}
            recentSales={recentSales}
            recentChats={recentChats}
            recentRefunds={recentRefunds}
            recentCrypto={recentCrypto}
            recentDevices={recentDevices}
            onJump={switchSection}
          />
        ) : null}

        {activeSection === "chats" ? (
          <ChatsSection
            isMobile={isMobile}
            stage={chatMobileStage}
            setStage={setChatMobileStage}
            filter={chatFilter}
            setFilter={setChatFilter}
            threads={filteredThreads}
            selectedThread={selectedThread}
            selectedThreadId={selectedThreadId}
            setSelectedThreadId={setSelectedThreadId}
            selectedDevice={selectedThreadDevice}
            messages={messages}
            draft={draft}
            setDraft={setDraft}
            isSending={isSending}
            isUpdatingThread={isUpdatingThread}
            assignToMe={assignToMe}
            updateThreadStatus={updateThreadStatus}
            sendMessage={sendMessage}
            operatorName={operatorName}
            messagesEndRef={messagesEndRef}
          />
        ) : null}

        {activeSection === "refunds" ? (
          <RefundsSection
            isMobile={isMobile}
            stage={refundMobileStage}
            setStage={setRefundMobileStage}
            filter={refundFilter}
            setFilter={setRefundFilter}
            refunds={filteredRefunds}
            selectedRefund={selectedRefund}
            selectedRefundId={selectedRefundId}
            setSelectedRefundId={setSelectedRefundId}
            isUpdatingRefund={isUpdatingRefund}
            markRefundReviewed={markRefundReviewed}
          />
        ) : null}

        {activeSection === "sales" ? (
          <SalesSection
            isMobile={isMobile}
            stage={salesMobileStage}
            setStage={setSalesMobileStage}
            purchases={filteredPurchases}
            selectedPurchase={selectedPurchase}
            selectedPurchaseId={selectedPurchaseId}
            setSelectedPurchaseId={setSelectedPurchaseId}
          />
        ) : null}

        {activeSection === "crypto" ? (
          <CryptoSection
            isMobile={isMobile}
            stage={cryptoMobileStage}
            setStage={setCryptoMobileStage}
            payments={filteredCryptoPayments}
            selectedPayment={selectedCryptoPayment}
            selectedPaymentId={selectedCryptoId}
            setSelectedPaymentId={setSelectedCryptoId}
          />
        ) : null}

        {activeSection === "devices" ? (
          <DevicesSection
            isMobile={isMobile}
            stage={devicesMobileStage}
            setStage={setDevicesMobileStage}
            devices={filteredDevices}
            selectedDevice={selectedDevice}
            selectedDeviceId={selectedDeviceId}
            setSelectedDeviceId={setSelectedDeviceId}
          />
        ) : null}
      </main>
    </div>
  );
}

function DashboardSection({
  metrics,
  weeklySales,
  recentSales,
  recentChats,
  recentRefunds,
  recentCrypto,
  recentDevices,
  onJump,
}) {
  return (
    <section className="section-stack">
      <div className="metric-grid">
        {metrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
      </div>

      <div className="dashboard-grid">
        <Card title="Son 7 gun satis" actionLabel="Satislar" onAction={() => onJump("sales")}>
          <div className="chart-shell">
            {weeklySales.map((item) => (
              <div className="bar-column" key={item.key}>
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{ height: `${item.height}%` }}
                    title={`${item.label} · ${formatMoney(item.total, "USD")}`}
                  />
                </div>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Canli durum">
          <div className="stack-list">
            <CompactLine label="Bekleyen refund" value={String(metrics[4]?.raw ?? 0)} tone="alert" />
            <CompactLine label="Acik sohbet" value={String(metrics[2]?.raw ?? 0)} />
            <CompactLine label="Aktif abone" value={String(metrics[5]?.raw ?? 0)} />
            <CompactLine label="Banli cihaz" value={String(metrics[6]?.raw ?? 0)} tone="muted" />
          </div>
        </Card>

        <Card title="Son satislar" actionLabel="Tum satislar" onAction={() => onJump("sales")}>
          <SimpleList
            items={recentSales}
            emptyLabel="Satis yok"
            renderItem={(item) => (
              <ListRow
                title={item.productId || "Urun"}
                subtitle={`${item.deviceId || "-"} · ${item.store || "-"}`}
                value={formatMoney(item.price, item.currency)}
              />
            )}
          />
        </Card>

        <Card title="Acik sohbetler" actionLabel="Sohbetler" onAction={() => onJump("chats")}>
          <SimpleList
            items={recentChats}
            emptyLabel="Sohbet yok"
            renderItem={(item) => (
              <ListRow
                title={item.subject || "Destek"}
                subtitle={item.lastMessageText || "Mesaj yok"}
                value={formatDate(item.updatedAt || item.createdAt, true)}
              />
            )}
          />
        </Card>

        <Card title="Refund kuyrugu" actionLabel="Refundlar" onAction={() => onJump("refunds")}>
          <SimpleList
            items={recentRefunds}
            emptyLabel="Bekleyen refund yok"
            renderItem={(item) => (
              <ListRow
                title={item.productId || "Refund"}
                subtitle={item.deviceId || item.appUserId || "-"}
                value={formatDate(item.eventTimestamp || item.createdAt, true)}
              />
            )}
          />
        </Card>

        <Card title="Kripto odemeler" actionLabel="Kripto" onAction={() => onJump("crypto")}>
          <SimpleList
            items={recentCrypto}
            emptyLabel="Kayit yok"
            renderItem={(item) => (
              <ListRow
                title={item.productId || item.orderId || "Odeme"}
                subtitle={item.status || "-"}
                value={formatMoney(item.priceAmount || item.payAmount, item.priceCurrency || item.payCurrency)}
              />
            )}
          />
        </Card>

        <Card title="Yeni cihazlar" actionLabel="Cihazlar" onAction={() => onJump("devices")}>
          <SimpleList
            items={recentDevices}
            emptyLabel="Cihaz yok"
            renderItem={(item) => (
              <ListRow
                title={item.mail || item.deviceId || "Cihaz"}
                subtitle={item.referralCode || "Kod yok"}
                value={safeNumber(item.credits).toString()}
              />
            )}
          />
        </Card>
      </div>
    </section>
  );
}

function ChatsSection({
  isMobile,
  stage,
  setStage,
  filter,
  setFilter,
  threads,
  selectedThread,
  selectedThreadId,
  setSelectedThreadId,
  selectedDevice,
  messages,
  draft,
  setDraft,
  isSending,
  isUpdatingThread,
  assignToMe,
  updateThreadStatus,
  sendMessage,
  operatorName,
  messagesEndRef,
}) {
  const showList = !isMobile || stage === "list";
  const showDetail = !isMobile || stage === "detail";

  return (
    <section className="section-stack">
      <div className="pill-row">
        {[
          { id: "open", label: "Acik" },
          { id: "closed", label: "Kapali" },
          { id: "all", label: "Tum" },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            className={`pill-button ${filter === item.id ? "active" : ""}`}
            onClick={() => setFilter(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="workspace-grid chats-grid">
        {showList ? (
          <Card title="Sohbetler" className={isMobile && showDetail ? "hidden-mobile" : ""}>
            <SimpleList
              items={threads}
              emptyLabel="Sohbet yok"
              interactive
              selectedId={selectedThreadId}
              onSelect={(item) => {
                setSelectedThreadId(item.id);
                if (isMobile) {
                  setStage("detail");
                }
              }}
              renderItem={(item) => (
                <ThreadRow item={item} />
              )}
            />
          </Card>
        ) : null}

        {showDetail ? (
          <Card
            title={selectedThread?.subject || "Sohbet"}
            actionLabel={isMobile ? "Liste" : null}
            onAction={isMobile ? () => setStage("list") : null}
          >
            {selectedThread ? (
              <div className="conversation-shell">
                <div className="conversation-head">
                  <div className="conversation-meta">
                    <strong>{selectedThread.deviceId || "-"}</strong>
                    <span>{STATUS_LABELS[selectedThread.status] || "Acik"}</span>
                  </div>
                  <div className="conversation-actions">
                    <button className="ghost-button compact-button" type="button" onClick={assignToMe} disabled={isUpdatingThread}>
                      Ustlen
                    </button>
                    {selectedThread.status === CLOSED_CHAT_STATUS ? (
                      <button
                        className="ghost-button compact-button"
                        type="button"
                        onClick={() => updateThreadStatus("waiting_user")}
                        disabled={isUpdatingThread}
                      >
                        Ac
                      </button>
                    ) : (
                      <button
                        className="ghost-button compact-button"
                        type="button"
                        onClick={() => updateThreadStatus(CLOSED_CHAT_STATUS)}
                        disabled={isUpdatingThread}
                      >
                        Kapat
                      </button>
                    )}
                  </div>
                </div>

                <div className="messages">
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={`message-row ${message.senderType === "support" ? "outbound" : "inbound"}`}
                    >
                      <div className="message-bubble">
                        <div className="message-author">
                          {message.senderType === "support"
                            ? message.senderName || selectedThread.assignedOperatorName || operatorName
                            : "Kullanici"}
                        </div>
                        <div>{message.text}</div>
                        <div className="message-time">{formatDate(message.createdAt, true)}</div>
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>

                <form className="composer" onSubmit={sendMessage}>
                  <input
                    type="text"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Mesaj yaz"
                    disabled={selectedThread.status === CLOSED_CHAT_STATUS}
                  />
                  <button
                    className="primary-button"
                    type="submit"
                    disabled={isSending || selectedThread.status === CLOSED_CHAT_STATUS || !draft.trim()}
                  >
                    {isSending ? "..." : "Gonder"}
                  </button>
                </form>
              </div>
            ) : (
              <EmptyCard label="Bir sohbet sec." />
            )}
          </Card>
        ) : null}

        {!isMobile ? (
          <Card title="Cihaz">
            {selectedThread ? (
              <SummaryGrid
                rows={[
                  ["Mail", selectedDevice?.mail || selectedThread.deviceSnapshot?.mail || "-"],
                  ["Kredi", String(selectedDevice?.credits ?? selectedThread.deviceSnapshot?.credits ?? "-")],
                  ["Abonelik", selectedDevice?.hasSubscription || selectedThread.deviceSnapshot?.hasSubscription ? "Var" : "Yok"],
                  ["Ban", selectedDevice?.ban || selectedDevice?.isBanned ? "Evet" : "Hayir"],
                  ["iOS", selectedThread.deviceSnapshot?.iosVersion || "-"],
                  ["App", selectedThread.deviceSnapshot?.appVersion || "-"],
                ]}
              />
            ) : (
              <EmptyCard label="Cihaz bilgisi yok." />
            )}
          </Card>
        ) : null}
      </div>
    </section>
  );
}

function RefundsSection({
  isMobile,
  stage,
  setStage,
  filter,
  setFilter,
  refunds,
  selectedRefund,
  selectedRefundId,
  setSelectedRefundId,
  isUpdatingRefund,
  markRefundReviewed,
}) {
  const showList = !isMobile || stage === "list";
  const showDetail = !isMobile || stage === "detail";

  return (
    <section className="section-stack">
      <div className="pill-row">
        {[
          { id: "pending", label: "Bekleyen" },
          { id: "reviewed", label: "Incelenen" },
          { id: "all", label: "Tum" },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            className={`pill-button ${filter === item.id ? "active" : ""}`}
            onClick={() => setFilter(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="workspace-grid refunds-grid">
        {showList ? (
          <Card title="Refundlar">
            <SimpleList
              items={refunds}
              emptyLabel="Refund yok"
              interactive
              selectedId={selectedRefundId}
              onSelect={(item) => {
                setSelectedRefundId(item.id);
                if (isMobile) {
                  setStage("detail");
                }
              }}
              renderItem={(item) => (
                <ListRow
                  title={item.productId || "Refund"}
                  subtitle={`${item.deviceId || item.appUserId || "-"} · ${REFUND_STATUS_LABELS[item.status] || "Bekliyor"}`}
                  value={formatDate(item.eventTimestamp || item.createdAt, true)}
                />
              )}
            />
          </Card>
        ) : null}

        {showDetail ? (
          <Card
            title={selectedRefund?.productId || "Refund"}
            actionLabel={isMobile ? "Liste" : null}
            onAction={isMobile ? () => setStage("list") : null}
          >
            {selectedRefund ? (
              <div className="detail-stack">
                <SummaryGrid
                  rows={[
                    ["Durum", REFUND_STATUS_LABELS[selectedRefund.status] || "Bekliyor"],
                    ["Reviewed", selectedRefund.reviewed ? "Evet" : "Hayir"],
                    ["Device", selectedRefund.deviceId || "-"],
                    ["App User", selectedRefund.appUserId || "-"],
                    ["Original TX", selectedRefund.originalTransactionId || "-"],
                    ["TX", selectedRefund.transactionId || "-"],
                    ["Store", selectedRefund.store || "-"],
                    ["Ortam", selectedRefund.environment || "-"],
                    ["Tarih", formatDate(selectedRefund.eventTimestamp || selectedRefund.createdAt)],
                    ["Mail", selectedRefund.deviceMail || "-"],
                  ]}
                />

                <button
                  className="primary-button wide-button"
                  type="button"
                  onClick={markRefundReviewed}
                  disabled={isUpdatingRefund || selectedRefund.reviewed}
                >
                  {selectedRefund.reviewed ? "Incelendi" : isUpdatingRefund ? "Kaydediliyor..." : "Incelendi"}
                </button>

                <pre className="json-block">{JSON.stringify(selectedRefund.rawPayload || {}, null, 2)}</pre>
              </div>
            ) : (
              <EmptyCard label="Bir refund sec." />
            )}
          </Card>
        ) : null}
      </div>
    </section>
  );
}

function SalesSection({
  isMobile,
  stage,
  setStage,
  purchases,
  selectedPurchase,
  selectedPurchaseId,
  setSelectedPurchaseId,
}) {
  const showList = !isMobile || stage === "list";
  const showDetail = !isMobile || stage === "detail";

  return (
    <section className="workspace-grid sales-grid">
      {showList ? (
        <Card title="Satislar">
          <SimpleList
            items={purchases}
            emptyLabel="Satis yok"
            interactive
            selectedId={selectedPurchaseId}
            onSelect={(item) => {
              setSelectedPurchaseId(item.id);
              if (isMobile) {
                setStage("detail");
              }
            }}
            renderItem={(item) => (
              <ListRow
                title={item.productId || "Urun"}
                subtitle={`${item.deviceId || "-"} · ${item.store || item.source || "-"}`}
                value={formatMoney(item.price, item.currency)}
              />
            )}
          />
        </Card>
      ) : null}

      {showDetail ? (
        <Card
          title={selectedPurchase?.productId || "Satis"}
          actionLabel={isMobile ? "Liste" : null}
          onAction={isMobile ? () => setStage("list") : null}
        >
          {selectedPurchase ? (
            <SummaryGrid
              rows={[
                ["Device", selectedPurchase.deviceId || "-"],
                ["Urun", selectedPurchase.productId || "-"],
                ["Tutar", formatMoney(selectedPurchase.price, selectedPurchase.currency)],
                ["Store", selectedPurchase.store || "-"],
                ["Source", selectedPurchase.source || "-"],
                ["TX", selectedPurchase.transactionId || "-"],
                ["Original TX", selectedPurchase.originalTransactionId || "-"],
                ["Credits", String(selectedPurchase.creditsGranted ?? "-")],
                ["Bakiye Sonrasi", String(selectedPurchase.creditsBalanceAfter ?? "-")],
                ["Sandbox", selectedPurchase.isSandbox ? "Evet" : "Hayir"],
                ["Tarih", formatDate(selectedPurchase.purchasedAt || selectedPurchase.processedAt || selectedPurchase.updatedAt)],
              ]}
            />
          ) : (
            <EmptyCard label="Bir satis sec." />
          )}
        </Card>
      ) : null}
    </section>
  );
}

function CryptoSection({
  isMobile,
  stage,
  setStage,
  payments,
  selectedPayment,
  selectedPaymentId,
  setSelectedPaymentId,
}) {
  const showList = !isMobile || stage === "list";
  const showDetail = !isMobile || stage === "detail";

  return (
    <section className="workspace-grid sales-grid">
      {showList ? (
        <Card title="Kripto">
          <SimpleList
            items={payments}
            emptyLabel="Odeme yok"
            interactive
            selectedId={selectedPaymentId}
            onSelect={(item) => {
              setSelectedPaymentId(item.id);
              if (isMobile) {
                setStage("detail");
              }
            }}
            renderItem={(item) => (
              <ListRow
                title={item.productId || item.orderId || "Odeme"}
                subtitle={`${item.deviceId || "-"} · ${item.status || "-"}`}
                value={formatMoney(item.priceAmount || item.payAmount, item.priceCurrency || item.payCurrency)}
              />
            )}
          />
        </Card>
      ) : null}

      {showDetail ? (
        <Card
          title={selectedPayment?.productId || selectedPayment?.orderId || "Odeme"}
          actionLabel={isMobile ? "Liste" : null}
          onAction={isMobile ? () => setStage("list") : null}
        >
          {selectedPayment ? (
            <SummaryGrid
              rows={[
                ["Order", selectedPayment.orderId || "-"],
                ["Device", selectedPayment.deviceId || "-"],
                ["Durum", selectedPayment.status || "-"],
                ["Credits", String(selectedPayment.totalCredits ?? selectedPayment.credits ?? "-")],
                ["Tutar", formatMoney(selectedPayment.priceAmount || selectedPayment.payAmount, selectedPayment.priceCurrency || selectedPayment.payCurrency)],
                ["Invoice", selectedPayment.providerInvoiceId || "-"],
                ["Payment", selectedPayment.providerPaymentId || "-"],
                ["Credited", selectedPayment.credited ? "Evet" : "Hayir"],
                ["Tarih", formatDate(selectedPayment.updatedAt || selectedPayment.createdAt)],
              ]}
            />
          ) : (
            <EmptyCard label="Bir odeme sec." />
          )}
        </Card>
      ) : null}
    </section>
  );
}

function DevicesSection({
  isMobile,
  stage,
  setStage,
  devices,
  selectedDevice,
  selectedDeviceId,
  setSelectedDeviceId,
}) {
  const showList = !isMobile || stage === "list";
  const showDetail = !isMobile || stage === "detail";

  return (
    <section className="workspace-grid sales-grid">
      {showList ? (
        <Card title="Cihazlar">
          <SimpleList
            items={devices}
            emptyLabel="Cihaz yok"
            interactive
            selectedId={selectedDeviceId}
            onSelect={(item) => {
              setSelectedDeviceId(item.deviceId || item.id);
              if (isMobile) {
                setStage("detail");
              }
            }}
            renderItem={(item) => (
              <ListRow
                title={item.mail || item.deviceId || "Cihaz"}
                subtitle={`${item.referralCode || "Kod yok"} · ${item.hasSubscription ? "Abone" : "Free"}`}
                value={String(safeNumber(item.credits))}
              />
            )}
          />
        </Card>
      ) : null}

      {showDetail ? (
        <Card
          title={selectedDevice?.mail || selectedDevice?.deviceId || "Cihaz"}
          actionLabel={isMobile ? "Liste" : null}
          onAction={isMobile ? () => setStage("list") : null}
        >
          {selectedDevice ? (
            <SummaryGrid
              rows={[
                ["Device", selectedDevice.deviceId || selectedDevice.id || "-"],
                ["Mail", selectedDevice.mail || "-"],
                ["Apple User", selectedDevice.appleUserID || "-"],
                ["Credits", String(safeNumber(selectedDevice.credits))],
                ["Abonelik", selectedDevice.hasSubscription ? "Var" : "Yok"],
                ["Referral", selectedDevice.referralCode || "-"],
                ["Referral Uses", String(safeNumber(selectedDevice.referralSuccessfulCount))],
                ["Referral Credits", String(safeNumber(selectedDevice.referralEarnedCredits))],
                ["Ban", selectedDevice.ban ? "Evet" : "Hayir"],
                ["Ban Reason", selectedDevice.banReason || "-"],
                ["Updated", formatDate(selectedDevice.updatedAt)],
              ]}
            />
          ) : (
            <EmptyCard label="Bir cihaz sec." />
          )}
        </Card>
      ) : null}
    </section>
  );
}

function Card({ title, actionLabel, onAction, className = "", children }) {
  return (
    <section className={`surface-card ${className}`.trim()}>
      <div className="card-head">
        <h2>{title}</h2>
        {actionLabel ? (
          <button type="button" className="text-button" onClick={onAction}>
            {actionLabel}
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function MetricCard({ label, value, meta, raw }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{meta || raw}</em>
    </div>
  );
}

function SimpleList({
  items,
  renderItem,
  emptyLabel,
  interactive = false,
  selectedId,
  onSelect,
}) {
  if (!items.length) {
    return <EmptyCard label={emptyLabel} />;
  }

  return (
    <div className="list-shell">
      {items.map((item) => {
        const content = renderItem(item);
        const key = item.id || item.deviceId;
        const isSelected = selectedId === item.id || selectedId === item.deviceId;

        if (!interactive) {
          return (
            <div className="list-item" key={key}>
              {content}
            </div>
          );
        }

        return (
          <button
            type="button"
            className={`list-item interactive ${isSelected ? "selected" : ""}`}
            key={key}
            onClick={() => onSelect?.(item)}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}

function ListRow({ title, subtitle, value }) {
  return (
    <div className="row-content">
      <div className="row-copy">
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
      <div className="row-value">{value}</div>
    </div>
  );
}

function ThreadRow({ item }) {
  return (
    <div className="row-content">
      <div className="row-copy">
        <strong>{item.subject || "Destek"}</strong>
        <span>{item.lastMessageText || "Mesaj yok"}</span>
      </div>
      <div className="thread-meta">
        <span className={`tiny-chip ${item.status === CLOSED_CHAT_STATUS ? "" : "accent"}`}>
          {STATUS_LABELS[item.status] || "Acik"}
        </span>
        {safeNumber(item.unreadBySupport) > 0 ? <em>{safeNumber(item.unreadBySupport)}</em> : null}
      </div>
    </div>
  );
}

function SummaryGrid({ rows }) {
  return (
    <div className="summary-grid">
      {rows.map(([label, value]) => (
        <div className="summary-row" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function CompactLine({ label, value, tone = "" }) {
  return (
    <div className={`compact-line ${tone}`.trim()}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EmptyCard({ label }) {
  return <div className="empty-card">{label}</div>;
}

function AppIcon({ name }) {
  const paths = {
    dashboard: "M4 5h7v6H4zm9 0h7v10h-7zM4 13h7v6H4zm9 4h7v2h-7z",
    chat: "M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6A2.5 2.5 0 0 1 16.5 15H10l-4 4v-4H7.5A2.5 2.5 0 0 1 5 12.5z",
    refund: "M7 8h9V5l4 4-4 4v-3H9a3 3 0 0 0 0 6h2v2H9a5 5 0 0 1-2-9.58zm8 8H6v3l-4-4 4-4v3h7a3 3 0 1 0 0-6h-2V6h2a5 5 0 0 1 2 10z",
    sales: "M5 18h14M7 16V9m5 7V6m5 10v-4",
    crypto: "M12 3v18M8.5 7.5a3.5 3.5 0 0 1 3.5-2h1a3 3 0 0 1 0 6h-2a3 3 0 0 0 0 6h1a3.5 3.5 0 0 0 3.5-2",
    devices: "M8 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zm3 13h2",
    menu: "M4 7h16M4 12h16M4 17h16",
    close: "M6 6l12 12M18 6 6 18",
    search: "m17 17 3 3M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z",
  };

  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name]} />
    </svg>
  );
}

function sectionTitle(section) {
  return NAV_ITEMS.find((item) => item.id === section)?.label || "Dashboard";
}

function sectionMeta(section, metrics) {
  switch (section) {
    case "dashboard":
      return `${metrics[0]?.meta || ""}`;
    case "chats":
      return "Canli destek";
    case "refunds":
      return "Iade kontrol";
    case "sales":
      return "RevenueCat + kripto";
    case "crypto":
      return "NOWPayments";
    case "devices":
      return "Kullanici havuzu";
    default:
      return "";
  }
}

function buildDashboardMetrics({ threads, refunds, purchases, cryptoPayments, devices }) {
  const today = startOfDay(new Date());
  const todayPurchases = purchases.filter((item) => isSameDay(item.purchasedAt || item.processedAt || item.updatedAt, today));
  const todayRevenue = todayPurchases.reduce((sum, item) => sum + safeMoney(item.price), 0);
  const totalRevenue = purchases.reduce((sum, item) => sum + safeMoney(item.price), 0);
  const openChats = threads.filter((thread) => thread.status !== CLOSED_CHAT_STATUS).length;
  const cryptoCompleted = cryptoPayments.filter((item) => CRYPTO_SUCCESS_STATUSES.has(normalize(item.status))).length;
  const activeSubscriptions = devices.filter((item) => item.hasSubscription).length;
  const bannedDevices = devices.filter((item) => item.ban).length;

  return [
    { label: "Bugun gelir", value: formatMoney(todayRevenue, "USD"), meta: `${todayPurchases.length} satis`, raw: todayRevenue },
    { label: "Toplam gelir", value: formatMoney(totalRevenue, "USD"), meta: `${purchases.length} islem`, raw: totalRevenue },
    { label: "Acik sohbet", value: String(openChats), meta: `${threads.length} toplam`, raw: openChats },
    { label: "Kripto odeme", value: String(cryptoCompleted), meta: `${cryptoPayments.length} kayit`, raw: cryptoCompleted },
    { label: "Bekleyen refund", value: String(refunds.filter((item) => !item.reviewed).length), meta: `${refunds.length} toplam`, raw: refunds.filter((item) => !item.reviewed).length },
    { label: "Aktif abone", value: String(activeSubscriptions), meta: `${devices.length} cihaz`, raw: activeSubscriptions },
    { label: "Banli cihaz", value: String(bannedDevices), meta: "Guvenlik", raw: bannedDevices },
  ];
}

function buildWeeklySales(purchases) {
  const days = [];
  const now = new Date();
  const labels = ["Pzt", "Sal", "Car", "Per", "Cum", "Cmt", "Paz"];
  const start = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6));

  for (let index = 0; index < 7; index += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const dayTotal = purchases
      .filter((item) => isSameDay(item.purchasedAt || item.processedAt || item.updatedAt, date))
      .reduce((sum, item) => sum + safeMoney(item.price), 0);

    days.push({ key: date.toISOString(), label: labels[(date.getDay() + 6) % 7], total: dayTotal });
  }

  const maxTotal = Math.max(...days.map((item) => item.total), 1);
  return days.map((item) => ({
    ...item,
    height: Math.max(12, Math.round((item.total / maxTotal) * 100)),
  }));
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isSameDay(value, dayStart) {
  const date = toDateValue(value);
  if (!date) return false;
  return startOfDay(date).getTime() === dayStart.getTime();
}

function safeMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function toDateValue(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === "function") return value.toDate();
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function timestampValue(value) {
  return toDateValue(value)?.getTime() || 0;
}

function formatDate(value, timeOnly = false) {
  const date = toDateValue(value);
  if (!date) return "-";

  return new Intl.DateTimeFormat(
    "tr-TR",
    timeOnly
      ? { hour: "2-digit", minute: "2-digit" }
      : { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }
  ).format(date);
}

function formatMoney(amount, currency) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return "-";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (currency || "USD").toUpperCase(),
    maximumFractionDigits: 2,
  }).format(value);
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function matchesQuery(queryValue, fields) {
  return fields.some((field) => normalize(field).includes(queryValue));
}

function getNotificationPermission() {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return "unsupported";
  }

  return Notification.permission;
}

function showIncomingSupportNotification({ threadId, subject, message, onOpen }) {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return;
  }

  const notification = new Notification(subject, {
    body: message,
    tag: `support-thread-${threadId}`,
    renotify: true,
  });

  notification.onclick = () => {
    notification.close();
    onOpen?.();
  };
}

export default App;
