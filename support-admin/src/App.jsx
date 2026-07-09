import { useEffect, useMemo, useRef, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  increment,
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

const STATUS_META = {
  waiting_support: {
    label: "Cevap bekliyor",
    tone: "warning",
  },
  waiting_user: {
    label: "Yanıtlandı",
    tone: "soft",
  },
  closed: {
    label: "Kapalı",
    tone: "closed",
  },
};

const REFUND_STATUS_LABELS = {
  pending_review: "Bekliyor",
  reviewed: "İncelendi",
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
const SETTINGS_DOCS = [
  { id: "app", title: "Uygulama", type: "flat" },
  { id: "api", title: "API", type: "flat" },
  { id: "products", title: "Ürünler", type: "json" },
  { id: "cryptoProduct", title: "Kripto Ürünleri", type: "json" },
];

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard" },
  { id: "chats", label: "Sohbetler", icon: "chat" },
  { id: "refunds", label: "Refundlar", icon: "refund" },
  { id: "sales", label: "Satışlar", icon: "sales" },
  { id: "crypto", label: "Kripto", icon: "crypto" },
  { id: "devices", label: "Cihazlar", icon: "devices" },
  { id: "settings", label: "Ayarlar", icon: "settings" },
];

function App() {
  const [user, setUser] = useState(null);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth <= MOBILE_BREAKPOINT : false
  );
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("dashboard");
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
  const [purchaseDrawerId, setPurchaseDrawerId] = useState("");

  const [cryptoPayments, setCryptoPayments] = useState([]);
  const [selectedCryptoId, setSelectedCryptoId] = useState("");
  const [cryptoDrawerId, setCryptoDrawerId] = useState("");

  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [deviceDrawerId, setDeviceDrawerId] = useState("");
  const [deviceOrders, setDeviceOrders] = useState([]);
  const [creditGrantInput, setCreditGrantInput] = useState("1");
  const [banReasonInput, setBanReasonInput] = useState("");
  const [isApplyingDeviceAction, setIsApplyingDeviceAction] = useState(false);

  const [settingsDocs, setSettingsDocs] = useState({});
  const [settingsDrafts, setSettingsDrafts] = useState({});
  const [isSavingSettings, setIsSavingSettings] = useState({});

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
          setErrorMessage("Bu hesap yetkili değil.");
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
    if (!user) {
      setSettingsDocs({});
      setSettingsDrafts({});
      return undefined;
    }

    const unsubscribers = SETTINGS_DOCS.map((item) =>
      onSnapshot(
        doc(db, "config", item.id),
        (snapshot) => {
          const data = snapshot.data() || {};
          setSettingsDocs((current) => ({ ...current, [item.id]: data }));
          setSettingsDrafts((current) => {
            if (current[item.id] !== undefined) {
              return current;
            }

            return {
              ...current,
              [item.id]: prepareSettingsDraft(item.id, data),
            };
          });
        },
        (error) => setErrorMessage(error.message)
      )
    );

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
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

  useEffect(() => {
    if (!deviceDrawerId) {
      setDeviceOrders([]);
      return undefined;
    }

    return onSnapshot(
      query(collection(db, "devices", deviceDrawerId, "orders"), orderBy("createdAt", "desc")),
      (snapshot) => {
        setDeviceOrders(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      },
      (error) => setErrorMessage(error.message)
    );
  }, [deviceDrawerId]);

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
    }
  }, [activeSection, isMobile]);

  const filteredThreads = useMemo(() => {
    if (chatFilter === "all") {
      return threads;
    }

    if (chatFilter === "closed") {
      return threads.filter((thread) => thread.status === CLOSED_CHAT_STATUS);
    }

    return threads.filter((thread) => thread.status !== CLOSED_CHAT_STATUS);
  }, [chatFilter, threads]);

  const filteredRefunds = useMemo(() => {
    if (refundFilter === "all") {
      return refunds;
    }

    if (refundFilter === "reviewed") {
      return refunds.filter((refund) => refund.reviewed);
    }

    return refunds.filter((refund) => !refund.reviewed);
  }, [refundFilter, refunds]);

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedThreadId) || null,
    [selectedThreadId, threads]
  );

  const selectedRefund = useMemo(
    () => refunds.find((refund) => refund.id === selectedRefundId) || null,
    [refunds, selectedRefundId]
  );

  const selectedPurchase = useMemo(
    () => purchases.find((purchase) => purchase.id === purchaseDrawerId) || null,
    [purchases, purchaseDrawerId]
  );

  const selectedCryptoPayment = useMemo(
    () => cryptoPayments.find((payment) => payment.id === cryptoDrawerId) || null,
    [cryptoPayments, cryptoDrawerId]
  );

  const selectedDrawerDevice = useMemo(
    () =>
      devices.find((device) => (device.deviceId || device.id) === deviceDrawerId) || null,
    [deviceDrawerId, devices]
  );

  const selectedThreadDevice = useMemo(() => {
    if (!selectedThread) {
      return null;
    }

    return devices.find((item) => (item.deviceId || item.id) === selectedThread.deviceId) || null;
  }, [devices, selectedThread]);

  const relatedDrawerPurchases = useMemo(() => {
    if (!deviceDrawerId) {
      return [];
    }

    return purchases
      .filter((item) => item.deviceId === deviceDrawerId)
      .sort((left, right) => timestampValue(right.updatedAt || right.purchasedAt) - timestampValue(left.updatedAt || left.purchasedAt));
  }, [deviceDrawerId, purchases]);

  const relatedDrawerCryptoPayments = useMemo(() => {
    if (!deviceDrawerId) {
      return [];
    }

    return cryptoPayments
      .filter((item) => item.deviceId === deviceDrawerId)
      .sort((left, right) => timestampValue(right.updatedAt || right.createdAt) - timestampValue(left.updatedAt || left.createdAt));
  }, [cryptoPayments, deviceDrawerId]);

  const relatedDrawerThreads = useMemo(() => {
    if (!deviceDrawerId) {
      return [];
    }

    return threads
      .filter((item) => item.deviceId === deviceDrawerId)
      .sort((left, right) => timestampValue(right.updatedAt || right.createdAt) - timestampValue(left.updatedAt || left.createdAt));
  }, [deviceDrawerId, threads]);

  const relatedDrawerRefunds = useMemo(() => {
    if (!deviceDrawerId) {
      return [];
    }

    return refunds
      .filter((item) => item.deviceId === deviceDrawerId)
      .sort((left, right) => timestampValue(right.eventTimestamp || right.createdAt) - timestampValue(left.eventTimestamp || left.createdAt));
  }, [deviceDrawerId, refunds]);

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
    if (selectedDrawerDevice) {
      setBanReasonInput(selectedDrawerDevice.banReason || "");
      setCreditGrantInput("1");
    }
  }, [selectedDrawerDevice]);

  const dashboardMetrics = useMemo(
    () =>
      buildDashboardMetrics({
        threads,
        refunds,
        purchases,
        cryptoPayments,
        devices,
      }),
    [threads, refunds, purchases, cryptoPayments, devices]
  );

  const weeklySales = useMemo(() => buildWeeklySales(purchases), [purchases]);
  const recentSales = useMemo(() => purchases.slice(0, 7), [purchases]);
  const recentChats = useMemo(
    () => threads.filter((thread) => thread.status !== CLOSED_CHAT_STATUS).slice(0, 6),
    [threads]
  );
  const recentRefunds = useMemo(() => refunds.filter((refund) => !refund.reviewed).slice(0, 6), [refunds]);
  const recentCrypto = useMemo(() => cryptoPayments.slice(0, 6), [cryptoPayments]);
  const recentDevices = useMemo(() => devices.slice(0, 6), [devices]);

  async function handleLogin(event) {
    event.preventDefault();

    const normalizedName = loginForm.name.trim();
    if (!normalizedName) {
      setErrorMessage("Operatör adı gir.");
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

  function openDeviceDrawer(deviceId) {
    if (!deviceId) {
      return;
    }

    setDeviceDrawerId(deviceId);
  }

  function closeDeviceDrawer() {
    setDeviceDrawerId("");
  }

  function openPurchaseDrawer(purchaseId) {
    setSelectedPurchaseId(purchaseId);
    setPurchaseDrawerId(purchaseId);
  }

  function closePurchaseDrawer() {
    setPurchaseDrawerId("");
  }

  function openCryptoDrawer(paymentId) {
    setSelectedCryptoId(paymentId);
    setCryptoDrawerId(paymentId);
  }

  function closeCryptoDrawer() {
    setCryptoDrawerId("");
  }

  function openThreadFromDrawer(threadId) {
    setDeviceDrawerId("");
    setActiveSection("chats");
    setSelectedThreadId(threadId);
    setChatMobileStage("detail");
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

  async function grantCreditsToDevice() {
    if (!selectedDrawerDevice) return;

    const creditsToGrant = Number(creditGrantInput);
    if (!Number.isFinite(creditsToGrant) || creditsToGrant <= 0) {
      setErrorMessage("Geçerli kredi miktarı gir.");
      return;
    }

    setIsApplyingDeviceAction(true);
    setErrorMessage("");

    try {
      await updateDoc(doc(db, "devices", selectedDrawerDevice.deviceId || selectedDrawerDevice.id), {
        credits: increment(creditsToGrant),
        updatedAt: serverTimestamp(),
      });
      setCreditGrantInput("1");
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setIsApplyingDeviceAction(false);
    }
  }

  async function toggleDeviceBan() {
    if (!selectedDrawerDevice) return;

    const nextBanState = !(selectedDrawerDevice.ban || selectedDrawerDevice.isBanned);

    setIsApplyingDeviceAction(true);
    setErrorMessage("");

    try {
      await updateDoc(doc(db, "devices", selectedDrawerDevice.deviceId || selectedDrawerDevice.id), {
        ban: nextBanState,
        isBanned: nextBanState,
        banReason: nextBanState ? banReasonInput.trim() : "",
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setIsApplyingDeviceAction(false);
    }
  }

  function setFlatSettingsValue(docId, key, nextValue) {
    setSettingsDrafts((current) => ({
      ...current,
      [docId]: {
        ...(current[docId] || {}),
        [key]: nextValue,
      },
    }));
  }

  function setJsonSettingsValue(docId, nextValue) {
    setSettingsDrafts((current) => ({
      ...current,
      [docId]: nextValue,
    }));
  }

  async function saveSettingsDoc(docId) {
    const descriptor = SETTINGS_DOCS.find((item) => item.id === docId);
    if (!descriptor) return;

    setIsSavingSettings((current) => ({ ...current, [docId]: true }));
    setErrorMessage("");

    try {
      let payload = settingsDrafts[docId];
      if (descriptor.type === "json") {
        payload = JSON.parse(payload || "{}");
      }

      await setDoc(doc(db, "config", docId), payload || {}, { merge: false });
      setSettingsDrafts((current) => ({
        ...current,
        [docId]: prepareSettingsDraft(docId, payload || {}),
      }));
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setIsSavingSettings((current) => ({ ...current, [docId]: false }));
    }
  }

  if (!user) {
    return (
      <div className="login-shell">
        <form className="login-card" onSubmit={handleLogin}>
          <div className="brand-lockup">
            <div>
              <strong>SMSX</strong>
              <span>Admin</span>
            </div>
          </div>
          <h1>Giriş</h1>

          <label>
            <span>Operatör</span>
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
            <span>Şifre</span>
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
            {isLoggingIn ? "Giriş..." : "Giriş yap"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <>
      <div className="shell">
        <aside className={`sidebar ${isSidebarOpen ? "open" : ""}`}>
          <div className="sidebar-head">
            <div className="brand-lockup">
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
              Çıkış yap
            </button>
          </div>
        </aside>

        {isSidebarOpen ? (
          <button className="sidebar-backdrop" type="button" onClick={() => setIsSidebarOpen(false)} />
        ) : null}

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
                {sectionMeta(activeSection, dashboardMetrics) ? (
                  <span>{sectionMeta(activeSection, dashboardMetrics)}</span>
                ) : null}
              </div>
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
              onOpenDevice={openDeviceDrawer}
              onOpenPurchase={openPurchaseDrawer}
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
              updateThreadStatus={updateThreadStatus}
              sendMessage={sendMessage}
              operatorName={operatorName}
              messagesEndRef={messagesEndRef}
              onOpenDevice={openDeviceDrawer}
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
              onOpenDevice={openDeviceDrawer}
            />
          ) : null}

          {activeSection === "sales" ? (
            <SalesSection
              purchases={purchases}
              selectedPurchaseId={selectedPurchaseId}
              setSelectedPurchaseId={setSelectedPurchaseId}
              onOpenPurchase={openPurchaseDrawer}
            />
          ) : null}

          {activeSection === "crypto" ? (
            <CryptoSection
              payments={cryptoPayments}
              selectedPaymentId={selectedCryptoId}
              setSelectedPaymentId={setSelectedCryptoId}
              onOpenPayment={openCryptoDrawer}
            />
          ) : null}

          {activeSection === "devices" ? (
            <DevicesSection
              devices={devices}
              selectedDeviceId={selectedDeviceId}
              setSelectedDeviceId={setSelectedDeviceId}
              onOpenDevice={openDeviceDrawer}
            />
          ) : null}

          {activeSection === "settings" ? (
            <SettingsSection
              docs={settingsDocs}
              drafts={settingsDrafts}
              isSaving={isSavingSettings}
              setFlatValue={setFlatSettingsValue}
              setJsonValue={setJsonSettingsValue}
              saveDoc={saveSettingsDoc}
            />
          ) : null}
        </main>
      </div>

      <DeviceDrawer
        isMobile={isMobile}
        isOpen={Boolean(deviceDrawerId)}
        device={selectedDrawerDevice}
        orders={deviceOrders}
        purchases={relatedDrawerPurchases}
        cryptoPayments={relatedDrawerCryptoPayments}
        threads={relatedDrawerThreads}
        refunds={relatedDrawerRefunds}
        creditGrantInput={creditGrantInput}
        setCreditGrantInput={setCreditGrantInput}
        banReasonInput={banReasonInput}
        setBanReasonInput={setBanReasonInput}
        isApplying={isApplyingDeviceAction}
        onGrantCredits={grantCreditsToDevice}
        onToggleBan={toggleDeviceBan}
        onClose={closeDeviceDrawer}
        onOpenPurchase={openPurchaseDrawer}
        onOpenCrypto={openCryptoDrawer}
        onOpenThread={openThreadFromDrawer}
      />

      <PurchaseDrawer
        isMobile={isMobile}
        purchase={selectedPurchase}
        isOpen={Boolean(purchaseDrawerId)}
        onClose={closePurchaseDrawer}
        onOpenDevice={openDeviceDrawer}
      />

      <CryptoDrawer
        isMobile={isMobile}
        payment={selectedCryptoPayment}
        isOpen={Boolean(cryptoDrawerId)}
        onClose={closeCryptoDrawer}
        onOpenDevice={openDeviceDrawer}
      />
    </>
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
  onOpenDevice,
  onOpenPurchase,
}) {
  return (
    <section className="section-stack">
      <div className="metric-grid">
        {metrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
      </div>

      <div className="dashboard-grid">
        <Card title="Son 7 gün satış" actionLabel="Satışlar" onAction={() => onJump("sales")}>
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

        <Card title="Canlı durum">
          <div className="stack-list">
            <CompactLine label="Bekleyen refund" value={String(metrics[4]?.raw ?? 0)} tone="alert" />
            <CompactLine label="Açık sohbet" value={String(metrics[2]?.raw ?? 0)} />
            <CompactLine label="Aktif abone" value={String(metrics[5]?.raw ?? 0)} />
            <CompactLine label="Banlı cihaz" value={String(metrics[6]?.raw ?? 0)} />
          </div>
        </Card>

        <Card title="Son satışlar" actionLabel="Tüm satışlar" onAction={() => onJump("sales")}>
          <SimpleList
            items={recentSales}
            emptyLabel="Satış yok"
            interactive
            onSelect={(item) => onOpenPurchase(item.id)}
            renderItem={(item) => (
              <ListRow
                title={item.productId || "Ürün"}
                subtitle={`${item.store || item.source || "-"} · ${formatDate(item.updatedAt || item.purchasedAt, true)}`}
                value={formatMoney(item.price, item.currency)}
              />
            )}
          />
        </Card>

        <Card title="Açık sohbetler" actionLabel="Sohbetler" onAction={() => onJump("chats")}>
          <SimpleList
            items={recentChats}
            emptyLabel="Sohbet yok"
            renderItem={(item) => (
              <ThreadRow item={item} />
            )}
          />
        </Card>

        <Card title="Refund kuyruğu" actionLabel="Refundlar" onAction={() => onJump("refunds")}>
          <SimpleList
            items={recentRefunds}
            emptyLabel="Bekleyen refund yok"
            renderItem={(item) => (
              <ListRow
                title={item.productId || "Refund"}
                subtitle={formatDate(item.eventTimestamp || item.createdAt, true)}
                value={item.deviceId || "-"}
              />
            )}
          />
        </Card>

        <Card title="Kripto ödemeler" actionLabel="Kripto" onAction={() => onJump("crypto")}>
          <SimpleList
            items={recentCrypto}
            emptyLabel="Kayıt yok"
            renderItem={(item) => (
              <ListRow
                title={item.productId || item.orderId || "Ödeme"}
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
            interactive
            onSelect={(item) => onOpenDevice(item.deviceId || item.id)}
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
  updateThreadStatus,
  sendMessage,
  operatorName,
  messagesEndRef,
  onOpenDevice,
}) {
  const showList = !isMobile || stage === "list";
  const showDetail = !isMobile || stage === "detail";

  return (
    <section className="section-stack">
      <div className="pill-row">
        {[
          { id: "open", label: "Açık" },
          { id: "closed", label: "Kapalı" },
          { id: "all", label: "Tüm" },
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

      <div className="workspace-grid chats-grid compact-grid">
        {showList ? (
          <Card title="Sohbetler">
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
              renderItem={(item) => <ThreadRow item={item} />}
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
                  <div className="conversation-meta vertical">
                    <DeviceButton
                      deviceId={selectedThread.deviceId}
                      onClick={() => onOpenDevice(selectedThread.deviceId)}
                    />
                    <div className="conversation-subline">
                      <StatusBadge status={selectedThread.status} />
                      {selectedDevice?.mail || selectedThread.deviceSnapshot?.mail ? (
                        <span>{selectedDevice?.mail || selectedThread.deviceSnapshot?.mail}</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="conversation-actions">
                    {selectedThread.status === CLOSED_CHAT_STATUS ? (
                      <button
                        className="ghost-button compact-button"
                        type="button"
                        onClick={() => updateThreadStatus("waiting_user")}
                        disabled={isUpdatingThread}
                      >
                        Tekrar aç
                      </button>
                    ) : (
                      <button
                        className="danger-button compact-button"
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
                  {messages.length ? (
                    messages.map((message) => (
                      <div
                        key={message.id}
                        className={`message-row ${message.senderType === "support" ? "outbound" : "inbound"}`}
                      >
                        <div className="message-bubble">
                          <div className="message-author">
                            {message.senderType === "support"
                              ? message.senderName || selectedThread.assignedOperatorName || operatorName
                              : "Kullanıcı"}
                          </div>
                          <div>{message.text}</div>
                          <div className="message-time">{formatDate(message.createdAt, true)}</div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <EmptyCard label="Mesaj yok." />
                  )}
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
                    {isSending ? "..." : "Gönder"}
                  </button>
                </form>
              </div>
            ) : (
              <EmptyCard label="Bir sohbet seç." />
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
  onOpenDevice,
}) {
  const showList = !isMobile || stage === "list";
  const showDetail = !isMobile || stage === "detail";

  return (
    <section className="section-stack">
      <div className="pill-row">
        {[
          { id: "pending", label: "Bekleyen" },
          { id: "reviewed", label: "İncelenen" },
          { id: "all", label: "Tüm" },
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

      <div className="workspace-grid refunds-grid compact-grid">
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
                  subtitle={`${REFUND_STATUS_LABELS[item.status] || "Bekliyor"} · ${formatDate(item.eventTimestamp || item.createdAt, true)}`}
                  value={item.deviceId || item.appUserId || "-"}
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
                    ["Reviewed", selectedRefund.reviewed ? "Evet" : "Hayır"],
                    [
                      "Device",
                      selectedRefund.deviceId ? (
                        <DeviceButton
                          deviceId={selectedRefund.deviceId}
                          onClick={() => onOpenDevice(selectedRefund.deviceId)}
                        />
                      ) : (
                        "-"
                      ),
                    ],
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
                  {selectedRefund.reviewed ? "İncelendi" : isUpdatingRefund ? "Kaydediliyor..." : "İncelendi"}
                </button>

                <pre className="json-block">{JSON.stringify(selectedRefund.rawPayload || {}, null, 2)}</pre>
              </div>
            ) : (
              <EmptyCard label="Bir refund seç." />
            )}
          </Card>
        ) : null}
      </div>
    </section>
  );
}

function SalesSection({ purchases, selectedPurchaseId, setSelectedPurchaseId, onOpenPurchase }) {
  return (
    <section className="section-stack">
      <Card title="Satışlar">
        <SimpleList
          items={purchases}
          emptyLabel="Satış yok"
          interactive
          selectedId={selectedPurchaseId}
          onSelect={(item) => {
            setSelectedPurchaseId(item.id);
            onOpenPurchase(item.id);
          }}
          renderItem={(item) => (
            <ListRow
              title={item.productId || "Ürün"}
              subtitle={`${item.store || item.source || "-"} · ${formatDate(item.updatedAt || item.purchasedAt, true)}`}
              value={formatMoney(item.price, item.currency)}
            />
          )}
        />
      </Card>
    </section>
  );
}

function CryptoSection({ payments, selectedPaymentId, setSelectedPaymentId, onOpenPayment }) {
  return (
    <section className="section-stack">
      <Card title="Kripto">
        <SimpleList
          items={payments}
          emptyLabel="Ödeme yok"
          interactive
          selectedId={selectedPaymentId}
          onSelect={(item) => {
            setSelectedPaymentId(item.id);
            onOpenPayment(item.id);
          }}
          renderItem={(item) => (
            <ListRow
              title={item.productId || item.orderId || "Ödeme"}
              subtitle={`${item.status || "-"} · ${formatDate(item.updatedAt || item.createdAt, true)}`}
              value={formatMoney(item.priceAmount || item.payAmount, item.priceCurrency || item.payCurrency)}
            />
          )}
        />
      </Card>
    </section>
  );
}

function DevicesSection({ devices, selectedDeviceId, setSelectedDeviceId, onOpenDevice }) {
  return (
    <section className="section-stack">
      <Card title="Cihazlar">
        <SimpleList
          items={devices}
          emptyLabel="Cihaz yok"
          interactive
          selectedId={selectedDeviceId}
          onSelect={(item) => {
            const resolvedId = item.deviceId || item.id;
            setSelectedDeviceId(resolvedId);
            onOpenDevice(resolvedId);
          }}
          renderItem={(item) => (
            <ListRow
              title={item.mail || item.deviceId || "Cihaz"}
              subtitle={`${item.hasSubscription ? "Abone" : "Free"} · ${item.referralCode || "Kod yok"}`}
              value={String(safeNumber(item.credits))}
            />
          )}
        />
      </Card>
    </section>
  );
}

function SettingsSection({ docs, drafts, isSaving, setFlatValue, setJsonValue, saveDoc }) {
  return (
    <section className="section-stack">
      <div className="settings-grid">
        {SETTINGS_DOCS.map((item) => (
          <Card
            key={item.id}
            title={item.title}
            actionLabel={isSaving[item.id] ? "Kaydediliyor..." : "Kaydet"}
            onAction={() => saveDoc(item.id)}
            className="settings-card"
          >
            {item.type === "flat" ? (
              <div className="settings-fields">
                {Object.entries(drafts[item.id] || docs[item.id] || {})
                  .sort(([left], [right]) => left.localeCompare(right))
                  .map(([key, value]) => (
                    <SettingField
                      key={key}
                      label={key}
                      value={value}
                      onChange={(nextValue) => setFlatValue(item.id, key, nextValue)}
                    />
                  ))}
              </div>
            ) : (
              <textarea
                className="settings-textarea"
                value={drafts[item.id] || ""}
                onChange={(event) => setJsonValue(item.id, event.target.value)}
              />
            )}
          </Card>
        ))}
      </div>
    </section>
  );
}

function DeviceDrawer({
  isMobile,
  isOpen,
  device,
  orders,
  purchases,
  cryptoPayments,
  threads,
  refunds,
  creditGrantInput,
  setCreditGrantInput,
  banReasonInput,
  setBanReasonInput,
  isApplying,
  onGrantCredits,
  onToggleBan,
  onClose,
  onOpenPurchase,
  onOpenCrypto,
  onOpenThread,
}) {
  if (!isOpen || !device) {
    return null;
  }

  const isBanned = Boolean(device.ban || device.isBanned);
  const pendingCrypto = cryptoPayments.filter(
    (item) => !CRYPTO_SUCCESS_STATUSES.has(normalize(item.status))
  );

  return (
    <SideSheet
      isMobile={isMobile}
      title={device.mail || device.deviceId || "Kullanıcı"}
      subtitle={device.deviceId || device.id || "-"}
      onClose={onClose}
    >
      <div className="drawer-section">
        <h3>Hızlı işlemler</h3>
        <div className="action-grid">
          <div className="inline-form">
            <input
              type="number"
              min="1"
              value={creditGrantInput}
              onChange={(event) => setCreditGrantInput(event.target.value)}
              placeholder="Kredi"
            />
            <button className="primary-button" type="button" onClick={onGrantCredits} disabled={isApplying}>
              Kredi ver
            </button>
          </div>

          <div className="stack-field">
            <input
              type="text"
              value={banReasonInput}
              onChange={(event) => setBanReasonInput(event.target.value)}
              placeholder="Ban nedeni"
            />
            <button
              className={isBanned ? "ghost-button" : "danger-button"}
              type="button"
              onClick={onToggleBan}
              disabled={isApplying}
            >
              {isBanned ? "Ban aç" : "Banla"}
            </button>
          </div>
        </div>
      </div>

      <div className="drawer-section">
        <h3>Özet</h3>
        <SummaryGrid
          rows={[
            ["Mail", device.mail || "-"],
            ["Kredi", String(safeNumber(device.credits))],
            ["Abonelik", device.hasSubscription ? "Var" : "Yok"],
            ["Ban", isBanned ? "Evet" : "Hayır"],
            ["Ban nedeni", device.banReason || "-"],
            ["Apple User", device.appleUserID || "-"],
            ["Referral", device.referralCode || "-"],
            ["Updated", formatDate(device.updatedAt)],
          ]}
        />
      </div>

      <DrawerGroup
        title="Aldığı numaralar"
        emptyLabel="Numara yok"
        items={orders}
        renderItem={(item) => (
          <ListRow
            title={`${item.countryFlag || ""} ${item.serviceName || "Servis"}`.trim()}
            subtitle={`${item.phoneNumber || "-"} · ${humanizeOrderStatus(item.status)}`}
            value={formatDate(item.createdAt, true)}
          />
        )}
      />

      <DrawerGroup
        title="Satın almalar"
        emptyLabel="Satın alma yok"
        items={purchases}
        interactive
        onSelect={(item) => onOpenPurchase(item.id)}
        renderItem={(item) => (
          <ListRow
            title={item.productId || "Ürün"}
            subtitle={`${item.store || item.source || "-"} · ${formatDate(item.updatedAt || item.purchasedAt, true)}`}
            value={formatMoney(item.price, item.currency)}
          />
        )}
      />

      <DrawerGroup
        title="Kripto ödemeler"
        emptyLabel="Kripto ödeme yok"
        items={cryptoPayments}
        interactive
        onSelect={(item) => onOpenCrypto(item.id)}
        renderItem={(item) => (
          <ListRow
            title={item.productId || item.orderId || "Ödeme"}
            subtitle={`${item.status || "-"} · ${formatDate(item.updatedAt || item.createdAt, true)}`}
            value={formatMoney(item.priceAmount || item.payAmount, item.priceCurrency || item.payCurrency)}
          />
        )}
      />

      <DrawerGroup
        title="Bekleyen ödemeler"
        emptyLabel="Bekleyen ödeme yok"
        items={pendingCrypto}
        renderItem={(item) => (
          <ListRow
            title={item.productId || item.orderId || "Ödeme"}
            subtitle={item.status || "-"}
            value={formatMoney(item.priceAmount || item.payAmount, item.priceCurrency || item.payCurrency)}
          />
        )}
      />

      <DrawerGroup
        title="Destek geçmişi"
        emptyLabel="Sohbet yok"
        items={threads}
        interactive
        onSelect={(item) => onOpenThread(item.id)}
        renderItem={(item) => <ThreadRow item={item} />}
      />

      <DrawerGroup
        title="Refundlar"
        emptyLabel="Refund yok"
        items={refunds}
        renderItem={(item) => (
          <ListRow
            title={item.productId || "Refund"}
            subtitle={`${REFUND_STATUS_LABELS[item.status] || "Bekliyor"} · ${formatDate(item.eventTimestamp || item.createdAt, true)}`}
            value={item.transactionId || "-"}
          />
        )}
      />
    </SideSheet>
  );
}

function PurchaseDrawer({ isMobile, purchase, isOpen, onClose, onOpenDevice }) {
  if (!isOpen || !purchase) {
    return null;
  }

  return (
    <SideSheet
      isMobile={isMobile}
      title={purchase.productId || "Satış"}
      subtitle={formatMoney(purchase.price, purchase.currency)}
      onClose={onClose}
    >
      <SummaryGrid
        rows={[
          [
            "Device",
            purchase.deviceId ? (
              <DeviceButton deviceId={purchase.deviceId} onClick={() => onOpenDevice(purchase.deviceId)} />
            ) : (
              "-"
            ),
          ],
          ["Store", purchase.store || "-"],
          ["Source", purchase.source || "-"],
          ["TX", purchase.transactionId || "-"],
          ["Original TX", purchase.originalTransactionId || "-"],
          ["Credits", String(purchase.creditsGranted ?? "-")],
          ["Bakiye sonrası", String(purchase.creditsBalanceAfter ?? "-")],
          ["Sandbox", purchase.isSandbox ? "Evet" : "Hayır"],
          ["Tarih", formatDate(purchase.purchasedAt || purchase.processedAt || purchase.updatedAt)],
        ]}
      />
    </SideSheet>
  );
}

function CryptoDrawer({ isMobile, payment, isOpen, onClose, onOpenDevice }) {
  if (!isOpen || !payment) {
    return null;
  }

  return (
    <SideSheet
      isMobile={isMobile}
      title={payment.productId || payment.orderId || "Kripto ödeme"}
      subtitle={payment.status || "-"}
      onClose={onClose}
    >
      <SummaryGrid
        rows={[
          [
            "Device",
            payment.deviceId ? (
              <DeviceButton deviceId={payment.deviceId} onClick={() => onOpenDevice(payment.deviceId)} />
            ) : (
              "-"
            ),
          ],
          ["Order", payment.orderId || "-"],
          ["Durum", payment.status || "-"],
          ["Credits", String(payment.totalCredits ?? payment.credits ?? "-")],
          ["Tutar", formatMoney(payment.priceAmount || payment.payAmount, payment.priceCurrency || payment.payCurrency)],
          ["Invoice", payment.providerInvoiceId || "-"],
          ["Payment", payment.providerPaymentId || "-"],
          ["Credited", payment.credited ? "Evet" : "Hayır"],
          ["Tarih", formatDate(payment.updatedAt || payment.createdAt)],
        ]}
      />
    </SideSheet>
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

function MetricCard({ label, value, meta }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{meta}</em>
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
        const key = item.id || item.deviceId;
        const isSelected = selectedId === item.id || selectedId === item.deviceId;

        if (!interactive) {
          return (
            <div className="list-item" key={key}>
              {renderItem(item)}
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
            {renderItem(item)}
          </button>
        );
      })}
    </div>
  );
}

function ThreadRow({ item }) {
  return (
    <div className="row-content">
      <div className="row-copy">
        <strong>{item.subject || "Destek Talebi"}</strong>
        <span>{item.lastMessageText || "Mesaj yok"}</span>
      </div>
      <div className="thread-meta">
        <StatusBadge status={item.status} compact />
        {safeNumber(item.unreadBySupport) > 0 ? <em>{safeNumber(item.unreadBySupport)}</em> : null}
      </div>
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

function StatusBadge({ status, compact = false }) {
  const meta = STATUS_META[status] || { label: "Açık", tone: "soft" };

  return <span className={`status-badge ${meta.tone} ${compact ? "compact" : ""}`.trim()}>{meta.label}</span>;
}

function DeviceButton({ deviceId, onClick }) {
  if (!deviceId) {
    return "-";
  }

  return (
    <button type="button" className="device-link" onClick={onClick}>
      {deviceId}
    </button>
  );
}

function DrawerGroup({ title, items, renderItem, emptyLabel, interactive = false, onSelect }) {
  return (
    <div className="drawer-section">
      <h3>{title}</h3>
      <SimpleList
        items={items}
        emptyLabel={emptyLabel}
        interactive={interactive}
        onSelect={onSelect}
        renderItem={renderItem}
      />
    </div>
  );
}

function SettingField({ label, value, onChange }) {
  if (typeof value === "boolean") {
    return (
      <div className="setting-row">
        <div className="setting-copy">
          <strong>{label}</strong>
        </div>
        <button
          type="button"
          className={`toggle-chip ${value ? "active" : ""}`}
          onClick={() => onChange(!value)}
        >
          {value ? "Açık" : "Kapalı"}
        </button>
      </div>
    );
  }

  const inputType = typeof value === "number" ? "number" : "text";

  return (
    <label className="setting-row">
      <div className="setting-copy">
        <strong>{label}</strong>
      </div>
      <input
        type={inputType}
        value={value}
        onChange={(event) => {
          if (typeof value === "number") {
            onChange(Number(event.target.value || 0));
            return;
          }

          onChange(event.target.value);
        }}
      />
    </label>
  );
}

function SideSheet({ isMobile, title, subtitle, onClose, children }) {
  return (
    <div className="sheet-layer">
      <button className="sheet-backdrop" type="button" onClick={onClose} />
      <aside className={`side-sheet ${isMobile ? "mobile" : ""}`}>
        <div className="sheet-head">
          <div>
            <h2>{title}</h2>
            {subtitle ? <span>{subtitle}</span> : null}
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Kapat">
            <AppIcon name="close" />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </aside>
    </div>
  );
}

function AppIcon({ name }) {
  const paths = {
    dashboard: "M4 5h7v6H4zm9 0h7v10h-7zM4 13h7v6H4zm9 4h7v2h-7z",
    chat: "M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6A2.5 2.5 0 0 1 16.5 15H10l-4 4v-4H7.5A2.5 2.5 0 0 1 5 12.5z",
    refund: "M7 8h9V5l4 4-4 4v-3H9a3 3 0 0 0 0 6h2v2H9a5 5 0 0 1-2-9.58zm8 8H6v3l-4-4 4-4v3h7a3 3 0 1 0 0-6h-2V6h2a5 5 0 0 1 2 10z",
    sales: "M5 18h14M7 16V9m5 7V6m5 10v-4",
    crypto: "M12 3v18M8.5 7.5a3.5 3.5 0 0 1 3.5-2h1a3 3 0 0 1 0 6h-2a3 3 0 0 0 0 6h1a3.5 3.5 0 0 0 3.5-2",
    devices: "M8 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zm3 13h2",
    settings: "M12 4.5l1.4 1.1 1.8-.3.8 1.6 1.8.7-.2 1.8 1.2 1.3-1.2 1.3.2 1.8-1.8.7-.8 1.6-1.8-.3L12 19.5l-1.4-1.1-1.8.3-.8-1.6-1.8-.7.2-1.8L5.2 12l1.2-1.3-.2-1.8 1.8-.7.8-1.6 1.8.3zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
    menu: "M4 7h16M4 12h16M4 17h16",
    close: "M6 6l12 12M18 6 6 18",
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
    case "settings":
      return "Firestore config";
    default:
      return "";
  }
}

function buildDashboardMetrics({ threads, refunds, purchases, cryptoPayments, devices }) {
  const today = startOfDay(new Date());
  const todayPurchases = purchases.filter((item) =>
    isSameDay(item.purchasedAt || item.processedAt || item.updatedAt, today)
  );
  const todayRevenue = todayPurchases.reduce((sum, item) => sum + safeMoney(item.price), 0);
  const totalRevenue = purchases.reduce((sum, item) => sum + safeMoney(item.price), 0);
  const openChats = threads.filter((thread) => thread.status !== CLOSED_CHAT_STATUS).length;
  const cryptoCompleted = cryptoPayments.filter((item) =>
    CRYPTO_SUCCESS_STATUSES.has(normalize(item.status))
  ).length;
  const activeSubscriptions = devices.filter((item) => item.hasSubscription).length;
  const bannedDevices = devices.filter((item) => item.ban || item.isBanned).length;

  return [
    {
      label: "Bugün gelir",
      value: formatMoney(todayRevenue, "USD"),
      meta: `${todayPurchases.length} satış`,
      raw: todayRevenue,
    },
    {
      label: "Toplam gelir",
      value: formatMoney(totalRevenue, "USD"),
      meta: `${purchases.length} işlem`,
      raw: totalRevenue,
    },
    {
      label: "Açık sohbet",
      value: String(openChats),
      meta: `${threads.length} toplam`,
      raw: openChats,
    },
    {
      label: "Kripto ödeme",
      value: String(cryptoCompleted),
      meta: `${cryptoPayments.length} kayıt`,
      raw: cryptoCompleted,
    },
    {
      label: "Bekleyen refund",
      value: String(refunds.filter((item) => !item.reviewed).length),
      meta: `${refunds.length} toplam`,
      raw: refunds.filter((item) => !item.reviewed).length,
    },
    {
      label: "Aktif abone",
      value: String(activeSubscriptions),
      meta: `${devices.length} cihaz`,
      raw: activeSubscriptions,
    },
    {
      label: "Banlı cihaz",
      value: String(bannedDevices),
      meta: "Güvenlik",
      raw: bannedDevices,
    },
  ];
}

function buildWeeklySales(purchases) {
  const days = [];
  const now = new Date();
  const labels = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
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
    height: Math.max(10, Math.round((item.total / maxTotal) * 100)),
  }));
}

function prepareSettingsDraft(docId, data) {
  const descriptor = SETTINGS_DOCS.find((item) => item.id === docId);
  if (!descriptor) {
    return data;
  }

  if (descriptor.type === "json") {
    return JSON.stringify(data || {}, null, 2);
  }

  return data || {};
}

function humanizeOrderStatus(status) {
  switch (status) {
    case "waiting":
      return "Bekliyor";
    case "verified":
      return "Kod geldi";
    case "cancelled":
      return "İptal";
    default:
      return status || "-";
  }
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
