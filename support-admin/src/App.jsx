import { useEffect, useMemo, useRef, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
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
const SETTINGS_ADMIN_EMAIL = (import.meta.env.VITE_SETTINGS_ADMIN || "").trim().toLowerCase();
const SETTINGS_PASSWORD = import.meta.env.VITE_SETTINGS_PASSWORD || "";

const OPERATOR_NAME_STORAGE_KEY = "smsx_support_operator_name";
const SETTINGS_ACCESS_STORAGE_KEY = "smsx_settings_access";
const APP_TITLE = "SMSX Admin";
const CLOSED_CHAT_STATUS = "closed";
const CRYPTO_SUCCESS_STATUSES = new Set(["finished", "confirmed"]);
const MOBILE_BREAKPOINT = 980;
const IOS_PACKAGE_USD_PRICES = {
  "com.isms.product1": 1,
  "com.isms.product2": 5,
  "com.isms.product3": 10,
  "com.isms.product4": 15,
};
const SETTINGS_DOCS = [
  { id: "app", title: "Uygulama", type: "flat" },
  { id: "api", title: "API", type: "flat" },
  { id: "products", title: "Ürünler", type: "json" },
  { id: "cryptoProduct", title: "Kripto Ürünleri", type: "json" },
];

const DEVICE_DRAWER_TABS = [
  { id: "orders", label: "Numaralar" },
  { id: "sales", label: "Satışlar" },
  { id: "crypto", label: "Kripto" },
  { id: "history", label: "Destek" },
];

const NAV_ITEMS = [
  { id: "dashboard", label: "Genel", icon: "dashboard" },
  { id: "chats", label: "Sohbetler", icon: "chat" },
  { id: "refunds", label: "İadeler", icon: "refund" },
  { id: "sales", label: "Satışlar", icon: "sales" },
  { id: "crypto", label: "Kripto", icon: "crypto" },
  { id: "devices", label: "Cihazlar", icon: "devices" },
  { id: "settings", label: "Ayarlar", icon: "settings" },
];

const SETTING_LABELS = {
  homeReferralSystem: "Ana sayfa referral sistemi",
  isMyNumberRating: "Numaralarım değerlendirmesi",
  multiPaymentMethod: "Çoklu ödeme yöntemi",
  settingsReferralSystem: "Ayarlar referral sistemi",
  topothercountry: "Popüler ülkeler",
  topservice: "Popüler servisler",
  cronMinute: "Cron dakikası",
  costOfCredit: "Kredi maliyeti",
  creditForRating: "Değerlendirme kredisi",
  exchangerate: "Kur",
  nowpaymentsApiKey: "NowPayments API anahtarı",
  nowpaymentsIpnSecret: "NowPayments IPN secret",
  nowpaymentsPriceCurrency: "NowPayments para birimi",
  revenuecatWebhookAuthorization: "RevenueCat webhook yetkisi",
  telegramBotToken: "Telegram bot token",
  telegramChatId: "Telegram chat ID",
};

const DEFAULT_PRODUCT_SCHEMAS = {
  products: [
    { key: "credits", type: "number", value: "0" },
  ],
  cryptoProduct: [
    { key: "price", type: "number", value: "0" },
    { key: "credit", type: "number", value: "0" },
    { key: "creditBonus", type: "number", value: "0" },
  ],
};

function mapSnapshotDocs(snapshot) {
  return snapshot.docs.map((item) => ({
    ...item.data(),
    id: item.id,
  }));
}

function hasGrantedCryptoCredits(payment) {
  return Boolean(payment?.credited || payment?.manualCreditGranted || payment?.creditedAt);
}

function hasOrderSms(order) {
  const smsCode = String(order?.smsCode || "").trim();
  const smsText = String(order?.smsText || "").trim();
  return Boolean(smsCode || smsText);
}

function orderSmsIndicatorText(order) {
  const smsCode = String(order?.smsCode || "").trim();
  if (smsCode) {
    return smsCode;
  }

  return hasOrderSms(order) ? "SMS geldi" : "";
}

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
  const [salesFilter, setSalesFilter] = useState("today");
  const [selectedPurchaseIds, setSelectedPurchaseIds] = useState([]);

  const [cryptoPayments, setCryptoPayments] = useState([]);
  const [selectedCryptoId, setSelectedCryptoId] = useState("");
  const [cryptoDrawerId, setCryptoDrawerId] = useState("");
  const [cryptoFilter, setCryptoFilter] = useState("all");
  const [cryptoDateFilter, setCryptoDateFilter] = useState("today");
  const [selectedCryptoIds, setSelectedCryptoIds] = useState([]);

  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [deviceDrawerId, setDeviceDrawerId] = useState("");
  const [deviceOrders, setDeviceOrders] = useState([]);
  const [deviceFilter, setDeviceFilter] = useState("all");
  const [deviceRewardFilter, setDeviceRewardFilter] = useState("all");
  const [deviceDateFilter, setDeviceDateFilter] = useState("today");
  const [creditGrantInput, setCreditGrantInput] = useState("1");
  const [banReasonInput, setBanReasonInput] = useState("");
  const [isApplyingDeviceAction, setIsApplyingDeviceAction] = useState(false);
  const [isApplyingCryptoAction, setIsApplyingCryptoAction] = useState(false);

  const [settingsDocs, setSettingsDocs] = useState({});
  const [settingsDrafts, setSettingsDrafts] = useState({});
  const [isSavingSettings, setIsSavingSettings] = useState({});
  const [settingsPasswordInput, setSettingsPasswordInput] = useState("");
  const [isSettingsUnlocked, setIsSettingsUnlocked] = useState(false);

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

  const normalizedUserEmail = useMemo(
    () => (user?.email || "").trim().toLowerCase(),
    [user]
  );

  const hasDirectSettingsAccess = useMemo(() => {
    if (!SETTINGS_ADMIN_EMAIL) {
      return false;
    }

    return normalizedUserEmail === SETTINGS_ADMIN_EMAIL;
  }, [normalizedUserEmail]);

  const canAccessSettings = hasDirectSettingsAccess || !SETTINGS_PASSWORD || isSettingsUnlocked;

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
    if (!user) {
      setIsSettingsUnlocked(false);
      setSettingsPasswordInput("");
      return;
    }

    if (hasDirectSettingsAccess || !SETTINGS_PASSWORD) {
      setIsSettingsUnlocked(true);
      return;
    }

    const storageKey = `${SETTINGS_ACCESS_STORAGE_KEY}:${normalizedUserEmail}`;
    const storedValue = localStorage.getItem(storageKey);
    setIsSettingsUnlocked(storedValue === "granted");
  }, [hasDirectSettingsAccess, normalizedUserEmail, user]);

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
        setThreads(mapSnapshotDocs(snapshot));
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
        setRefunds(mapSnapshotDocs(snapshot));
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
        setPurchases(mapSnapshotDocs(snapshot));
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
        setCryptoPayments(mapSnapshotDocs(snapshot));
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
        setDevices(mapSnapshotDocs(snapshot));
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
        setMessages(mapSnapshotDocs(snapshot));
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
        setDeviceOrders(mapSnapshotDocs(snapshot));
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
  const selectedThreadEmail =
    selectedThreadDevice?.mail || selectedThread?.deviceSnapshot?.mail || "";
  const isMobileChatDetail =
    isMobile && activeSection === "chats" && chatMobileStage === "detail";
  const canOpenSelectedThreadDevice = Boolean(selectedThread?.deviceId);

  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    document.body.classList.toggle("app-mobile-chat-lock", isMobileChatDetail);
    document.documentElement.classList.toggle("app-mobile-chat-lock", isMobileChatDetail);

    return () => {
      document.body.classList.remove("app-mobile-chat-lock");
      document.documentElement.classList.remove("app-mobile-chat-lock");
    };
  }, [isMobileChatDetail]);

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

  const filteredPurchases = useMemo(() => {
    const today = startOfDay(new Date());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const filtered = purchases.filter((item) => {
      const purchaseDate = item.purchasedAt || item.processedAt || item.updatedAt;

      if (salesFilter === "today") {
        return isSameDay(purchaseDate, today);
      }

      if (salesFilter === "yesterday") {
        return isSameDay(purchaseDate, yesterday);
      }

      return true;
    });

    return [...filtered].sort(
      (left, right) =>
        timestampValue(right.purchasedAt || right.processedAt || right.updatedAt) -
        timestampValue(left.purchasedAt || left.processedAt || left.updatedAt)
    );
  }, [purchases, salesFilter]);

  const filteredCryptoPayments = useMemo(() => {
    const today = startOfDay(new Date());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const filtered = cryptoPayments.filter((item) => {
      if (cryptoFilter === "credited" && !hasGrantedCryptoCredits(item)) {
        return false;
      }

      if (
        cryptoFilter === "uncredited"
        && (normalize(item.status) !== "partially_paid" || hasGrantedCryptoCredits(item))
      ) {
        return false;
      }

      if (cryptoFilter === "pending") {
        const normalizedStatus = normalize(item.status);
        if (normalizedStatus === "partially_paid" || CRYPTO_SUCCESS_STATUSES.has(normalizedStatus)) {
          return false;
        }
      }

      const paymentDate = item.updatedAt || item.createdAt;

      if (cryptoDateFilter === "today") {
        return isSameDay(paymentDate, today);
      }

      if (cryptoDateFilter === "yesterday") {
        return isSameDay(paymentDate, yesterday);
      }

      return true;
    });

    return [...filtered].sort(
      (left, right) =>
        timestampValue(right.updatedAt || right.createdAt) -
        timestampValue(left.updatedAt || left.createdAt)
    );
  }, [cryptoDateFilter, cryptoFilter, cryptoPayments]);

  const filteredDevices = useMemo(() => {
    const today = startOfDay(new Date());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const filtered = devices.filter((item) => {
      if (deviceFilter === "banned" && !(item.ban || item.isBanned)) {
        return false;
      }

      if (deviceFilter === "subscribed" && !item.hasSubscription) {
        return false;
      }

      if (deviceRewardFilter === "rewarded" && !item.hasClaimedRatingReward) {
        return false;
      }

      if (deviceRewardFilter === "not_rewarded" && item.hasClaimedRatingReward) {
        return false;
      }

      const deviceDate = item.updatedAt || item.createdAt;

      if (deviceDateFilter === "today") {
        return isSameDay(deviceDate, today);
      }

      if (deviceDateFilter === "yesterday") {
        return isSameDay(deviceDate, yesterday);
      }

      return true;
    });

    return [...filtered].sort(
      (left, right) =>
        timestampValue(right.updatedAt || right.createdAt) -
        timestampValue(left.updatedAt || left.createdAt)
    );
  }, [deviceDateFilter, deviceFilter, deviceRewardFilter, devices]);

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

  useEffect(() => {
    setSelectedPurchaseIds((current) =>
      current.filter((id) => filteredPurchases.some((item) => item.id === id))
    );
  }, [filteredPurchases]);

  useEffect(() => {
    setSelectedCryptoIds((current) =>
      current.filter((id) => filteredCryptoPayments.some((item) => item.id === id))
    );
  }, [filteredCryptoPayments]);

  function drillTo(target) {
    if (target.section === "chats") {
      setChatFilter(target.filter || "open");
    }

    if (target.section === "refunds") {
      setRefundFilter(target.filter || "pending");
    }

    if (target.section === "sales") {
      setSalesFilter(target.filter || "today");
    }

    if (target.section === "crypto") {
      setCryptoFilter(target.filter || "all");
    }

    if (target.section === "devices") {
      setDeviceFilter(target.filter || "all");
    }

    setActiveSection(target.section);
  }

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

  const packagePrices = useMemo(
    () => ({
      ...IOS_PACKAGE_USD_PRICES,
    }),
    []
  );

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

  function unlockSettingsAccess(event) {
    event.preventDefault();

    if (settingsPasswordInput !== SETTINGS_PASSWORD) {
      setErrorMessage("Ayarlar şifresi hatalı.");
      return;
    }

    const storageKey = `${SETTINGS_ACCESS_STORAGE_KEY}:${normalizedUserEmail}`;
    localStorage.setItem(storageKey, "granted");
    setIsSettingsUnlocked(true);
    setSettingsPasswordInput("");
    setErrorMessage("");
  }

  function switchSection(sectionId) {
    setActiveSection(sectionId);
    setIsSidebarOpen(false);
  }

  function openDeviceDrawer(deviceId) {
    if (!deviceId) {
      return;
    }

    setPurchaseDrawerId("");
    setCryptoDrawerId("");
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
      await writeAdminLog({
        user,
        operatorName,
        action: "grant_credits",
        targetId: selectedDrawerDevice.deviceId || selectedDrawerDevice.id,
        payload: { creditsToGrant },
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
    if (nextBanState && !banReasonInput.trim()) {
      setErrorMessage("Ban nedeni gir.");
      return;
    }

    setIsApplyingDeviceAction(true);
    setErrorMessage("");

    try {
      await updateDoc(doc(db, "devices", selectedDrawerDevice.deviceId || selectedDrawerDevice.id), {
        ban: nextBanState,
        isBanned: nextBanState,
        banReason: nextBanState ? banReasonInput.trim() : "",
        updatedAt: serverTimestamp(),
      });
      await writeAdminLog({
        user,
        operatorName,
        action: nextBanState ? "ban_device" : "unban_device",
        targetId: selectedDrawerDevice.deviceId || selectedDrawerDevice.id,
        payload: { banReason: nextBanState ? banReasonInput.trim() : "" },
      });
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setIsApplyingDeviceAction(false);
    }
  }

  async function manuallyGrantCryptoPaymentCredits() {
    if (!selectedCryptoPayment || !user) return;

    if (hasGrantedCryptoCredits(selectedCryptoPayment)) {
      setErrorMessage("Bu ödeme için kredi zaten verilmiş.");
      return;
    }

    const creditsToGrant = safeNumber(
      selectedCryptoPayment.totalCredits ?? selectedCryptoPayment.credits
    );

    if (!selectedCryptoPayment.deviceId || creditsToGrant <= 0) {
      setErrorMessage("Bu ödeme için verilecek kredi veya cihaz bilgisi yok.");
      return;
    }

    setIsApplyingCryptoAction(true);
    setErrorMessage("");

    try {
      await updateDoc(doc(db, "devices", selectedCryptoPayment.deviceId), {
        credits: increment(creditsToGrant),
        updatedAt: serverTimestamp(),
      });

      await updateDoc(doc(db, "cryptoPayments", selectedCryptoPayment.id), {
        credited: true,
        status: CRYPTO_SUCCESS_STATUSES.has(normalize(selectedCryptoPayment.status))
          ? selectedCryptoPayment.status
          : "confirmed",
        manualCreditGranted: true,
        manualCreditGrantedAt: serverTimestamp(),
        manualCreditGrantedBy: user.uid,
        manualCreditGrantedByName: operatorName,
        updatedAt: serverTimestamp(),
      });

      await writeAdminLog({
        user,
        operatorName,
        action: "grant_crypto_payment_credits",
        targetId: selectedCryptoPayment.id,
        payload: {
          deviceId: selectedCryptoPayment.deviceId,
          creditsToGrant,
          payAmount: selectedCryptoPayment.payAmount ?? null,
          priceAmount: selectedCryptoPayment.priceAmount ?? null,
        },
      });
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setIsApplyingCryptoAction(false);
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

  function setNestedSettingsValue(docId, path, nextValue) {
    setSettingsDrafts((current) => ({
      ...current,
      [docId]: updateNestedDraft(current[docId] || {}, path, nextValue),
    }));
  }

  function replaceSettingsDraft(docId, nextValue) {
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
      const payload = settingsDrafts[docId] || {};
      await setDoc(doc(db, "config", docId), payload || {}, { merge: false });
      await writeAdminLog({
        user,
        operatorName,
        action: "update_settings",
        targetId: docId,
        payload,
      });
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

  async function deletePurchaseRecord(purchaseId) {
    if (!purchaseId) return;

    setErrorMessage("");

    try {
      await deleteDoc(doc(db, "purchases", purchaseId));
      await writeAdminLog({
        user,
        operatorName,
        action: "delete_purchase",
        targetId: purchaseId,
      });
      setPurchaseDrawerId("");
      if (selectedPurchaseId === purchaseId) {
        setSelectedPurchaseId("");
      }
    } catch (error) {
      setErrorMessage(error.message);
    }
  }

  function togglePurchaseSelection(purchaseId) {
    setSelectedPurchaseIds((current) =>
      current.includes(purchaseId)
        ? current.filter((id) => id !== purchaseId)
        : [...current, purchaseId]
    );
  }

  function toggleAllPurchaseSelections() {
    if (!filteredPurchases.length) {
      return;
    }

    const visibleIds = filteredPurchases.map((item) => item.id);
    const isAllSelected = visibleIds.every((id) => selectedPurchaseIds.includes(id));
    setSelectedPurchaseIds(isAllSelected ? [] : visibleIds);
  }

  async function deleteSelectedPurchases() {
    if (!selectedPurchaseIds.length) {
      return;
    }

    if (!window.confirm(`${selectedPurchaseIds.length} satış kaydı silinsin mi?`)) {
      return;
    }

    setErrorMessage("");

    try {
      await Promise.all(selectedPurchaseIds.map((id) => deleteDoc(doc(db, "purchases", id))));
      await writeAdminLog({
        user,
        operatorName,
        action: "delete_purchases_bulk",
        payload: { ids: selectedPurchaseIds },
      });

      if (selectedPurchaseIds.includes(purchaseDrawerId)) {
        setPurchaseDrawerId("");
      }

      if (selectedPurchaseIds.includes(selectedPurchaseId)) {
        setSelectedPurchaseId("");
      }

      setSelectedPurchaseIds([]);
    } catch (error) {
      setErrorMessage(error.message);
    }
  }

  function toggleCryptoSelection(paymentId) {
    setSelectedCryptoIds((current) =>
      current.includes(paymentId)
        ? current.filter((id) => id !== paymentId)
        : [...current, paymentId]
    );
  }

  function toggleAllCryptoSelections() {
    if (!filteredCryptoPayments.length) {
      return;
    }

    const visibleIds = filteredCryptoPayments.map((item) => item.id);
    const isAllSelected = visibleIds.every((id) => selectedCryptoIds.includes(id));
    setSelectedCryptoIds(isAllSelected ? [] : visibleIds);
  }

  async function deleteSelectedCryptoPayments() {
    if (!selectedCryptoIds.length) {
      return;
    }

    if (!window.confirm(`${selectedCryptoIds.length} kripto ödeme kaydı silinsin mi?`)) {
      return;
    }

    setErrorMessage("");

    try {
      await Promise.all(selectedCryptoIds.map((id) => deleteDoc(doc(db, "cryptoPayments", id))));
      await writeAdminLog({
        user,
        operatorName,
        action: "delete_crypto_payments_bulk",
        payload: { ids: selectedCryptoIds },
      });

      if (selectedCryptoIds.includes(cryptoDrawerId)) {
        setCryptoDrawerId("");
      }

      if (selectedCryptoIds.includes(selectedCryptoId)) {
        setSelectedCryptoId("");
      }

      setSelectedCryptoIds([]);
    } catch (error) {
      setErrorMessage(error.message);
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

        <main className={`main ${isMobileChatDetail ? "mobile-chat-detail" : ""}`.trim()}>
          <header className={`topbar ${isMobileChatDetail ? "chat-detail-topbar" : ""}`.trim()}>
            <div className="topbar-left">
              <button
                type="button"
                className="icon-button only-mobile"
                onClick={() => {
                  if (isMobileChatDetail) {
                    setChatMobileStage("list");
                    return;
                  }

                  setIsSidebarOpen(true);
                }}
                aria-label={isMobileChatDetail ? "Sohbet listesine dön" : "Menüyü aç"}
              >
                <AppIcon name={isMobileChatDetail ? "chevronLeft" : "menu"} />
              </button>
              {isMobileChatDetail ? (
                canOpenSelectedThreadDevice ? (
                  <button
                    type="button"
                    className="topbar-profile"
                    onClick={() => openDeviceDrawer(selectedThread.deviceId)}
                  >
                    <div className="topbar-copy">
                      <h1>Profil</h1>
                      {selectedThreadEmail ? <span>{selectedThreadEmail}</span> : null}
                    </div>
                  </button>
                ) : (
                  <div className="topbar-copy">
                    <h1>Profil</h1>
                    {selectedThreadEmail ? <span>{selectedThreadEmail}</span> : null}
                  </div>
                )
              ) : (
                <div className="topbar-copy">
                  <h1>{sectionTitle(activeSection)}</h1>
                </div>
              )}
            </div>
            {isMobileChatDetail && selectedThread ? (
              <div className="topbar-actions">
                {selectedThread.status === CLOSED_CHAT_STATUS ? (
                  <button
                    className="ghost-button compact-button topbar-action-button"
                    type="button"
                    onClick={() => updateThreadStatus("waiting_user")}
                    disabled={isUpdatingThread}
                  >
                    Tekrar aç
                  </button>
                ) : (
                  <button
                    className="danger-button compact-button topbar-action-button"
                    type="button"
                    onClick={() => updateThreadStatus(CLOSED_CHAT_STATUS)}
                    disabled={isUpdatingThread}
                  >
                    Kapat
                  </button>
                )}
              </div>
            ) : null}
            {!isMobileChatDetail && activeSection === "sales" ? (
              <div className="topbar-actions">
                <button
                  className="icon-button topbar-icon-button"
                  type="button"
                  onClick={toggleAllPurchaseSelections}
                  aria-label={filteredPurchases.length > 0 && filteredPurchases.every((item) => selectedPurchaseIds.includes(item.id)) ? "Seçimi temizle" : "Tümünü seç"}
                >
                  <AppIcon
                    name={
                      filteredPurchases.length > 0 &&
                      filteredPurchases.every((item) => selectedPurchaseIds.includes(item.id))
                        ? "selectionOff"
                        : "selectionOn"
                    }
                  />
                </button>
                <button
                  className="icon-button topbar-icon-button danger"
                  type="button"
                  onClick={deleteSelectedPurchases}
                  disabled={!selectedPurchaseIds.length}
                  aria-label="Seçilen satışları sil"
                >
                  <AppIcon name="trash" />
                </button>
              </div>
            ) : null}
            {!isMobileChatDetail && activeSection === "crypto" ? (
              <div className="topbar-actions">
                <button
                  className="icon-button topbar-icon-button"
                  type="button"
                  onClick={toggleAllCryptoSelections}
                  aria-label={filteredCryptoPayments.length > 0 && filteredCryptoPayments.every((item) => selectedCryptoIds.includes(item.id)) ? "Seçimi temizle" : "Tümünü seç"}
                >
                  <AppIcon
                    name={
                      filteredCryptoPayments.length > 0 &&
                      filteredCryptoPayments.every((item) => selectedCryptoIds.includes(item.id))
                        ? "selectionOff"
                        : "selectionOn"
                    }
                  />
                </button>
                <button
                  className="icon-button topbar-icon-button danger"
                  type="button"
                  onClick={deleteSelectedCryptoPayments}
                  disabled={!selectedCryptoIds.length}
                  aria-label="Seçilen kripto ödemeleri sil"
                >
                  <AppIcon name="trash" />
                </button>
              </div>
            ) : null}
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
              onJump={drillTo}
              onOpenDevice={openDeviceDrawer}
              onOpenPurchase={openPurchaseDrawer}
              packagePrices={packagePrices}
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
              isMobile={isMobile}
              purchases={filteredPurchases}
              selectedPurchaseId={selectedPurchaseId}
              selectedPurchaseIds={selectedPurchaseIds}
              setSelectedPurchaseId={setSelectedPurchaseId}
              onOpenPurchase={openPurchaseDrawer}
              onToggleSelection={togglePurchaseSelection}
              onToggleAllSelections={toggleAllPurchaseSelections}
              onDeleteSelected={deleteSelectedPurchases}
              filter={salesFilter}
              setFilter={setSalesFilter}
              packagePrices={packagePrices}
            />
          ) : null}

          {activeSection === "crypto" ? (
            <CryptoSection
              isMobile={isMobile}
              payments={filteredCryptoPayments}
              selectedPaymentId={selectedCryptoId}
              selectedPaymentIds={selectedCryptoIds}
              setSelectedPaymentId={setSelectedCryptoId}
              onOpenPayment={openCryptoDrawer}
              onToggleSelection={toggleCryptoSelection}
              onToggleAllSelections={toggleAllCryptoSelections}
              onDeleteSelected={deleteSelectedCryptoPayments}
              filter={cryptoFilter}
              setFilter={setCryptoFilter}
              dateFilter={cryptoDateFilter}
              setDateFilter={setCryptoDateFilter}
            />
          ) : null}

          {activeSection === "devices" ? (
            <DevicesSection
              isMobile={isMobile}
              devices={filteredDevices}
              selectedDeviceId={selectedDeviceId}
              setSelectedDeviceId={setSelectedDeviceId}
              onOpenDevice={openDeviceDrawer}
              filter={deviceFilter}
              setFilter={setDeviceFilter}
              rewardFilter={deviceRewardFilter}
              setRewardFilter={setDeviceRewardFilter}
              dateFilter={deviceDateFilter}
              setDateFilter={setDeviceDateFilter}
            />
          ) : null}

          {activeSection === "settings" ? (
            canAccessSettings ? (
              <SettingsSection
                docs={settingsDocs}
                drafts={settingsDrafts}
                isSaving={isSavingSettings}
                setFlatValue={setFlatSettingsValue}
                setNestedValue={setNestedSettingsValue}
                setDocValue={replaceSettingsDraft}
                saveDoc={saveSettingsDoc}
                reportError={setErrorMessage}
              />
            ) : (
              <SettingsAccessGate
                email={user?.email || "-"}
                password={settingsPasswordInput}
                onPasswordChange={setSettingsPasswordInput}
                onSubmit={unlockSettingsAccess}
              />
            )
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
        onDelete={deletePurchaseRecord}
      />

      <CryptoDrawer
        isMobile={isMobile}
        payment={selectedCryptoPayment}
        isOpen={Boolean(cryptoDrawerId)}
        onClose={closeCryptoDrawer}
        onOpenDevice={openDeviceDrawer}
        onGrantCredits={manuallyGrantCryptoPaymentCredits}
        isApplyingCredits={isApplyingCryptoAction}
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
  packagePrices,
}) {
  return (
    <section className="section-stack">
      <div className="metric-grid">
        {metrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} onClick={() => onJump(metric.target)} />
        ))}
      </div>

      <Card title={<CardLinkTitle label="Son 7 gün satış" onClick={() => onJump({ section: "sales", filter: "all" })} />}>
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

      <Card title={<CardLinkTitle label="Canlı durum" onClick={() => onJump({ section: "dashboard" })} />}>
        <div className="stack-list">
          <CompactLine label="Bekleyen iade" value={String(metrics[4]?.raw ?? 0)} tone="alert" />
          <CompactLine label="Açık sohbet" value={String(metrics[2]?.raw ?? 0)} tone={Number(metrics[2]?.raw || 0) > 0 ? "danger" : "success"} />
          <CompactLine label="Aktif abone" value={String(metrics[5]?.raw ?? 0)} />
          <CompactLine label="Banlı cihaz" value={String(metrics[6]?.raw ?? 0)} />
          <CompactLine label="Eksik ödenen kripto" value={String(metrics[7]?.raw ?? 0)} tone={Number(metrics[7]?.raw || 0) > 0 ? "danger" : "neutral"} />
        </div>
      </Card>

      <Card title={<CardLinkTitle label="Son satışlar" onClick={() => onJump({ section: "sales", filter: "all" })} />}>
        <SimpleList
          items={recentSales}
          emptyLabel="Satış yok"
          interactive
          onSelect={(item) => onOpenPurchase(item.id)}
          renderItem={(item) => (
            <ListRow
              title={item.productId || "Ürün"}
              subtitle={`${item.store || item.source || "-"} · ${formatDate(item.updatedAt || item.purchasedAt, true)}`}
              value={formatCatalogPrice(item.productId, packagePrices, item.price, item.currency)}
            />
          )}
        />
      </Card>

      <Card title={<CardLinkTitle label="Açık sohbetler" onClick={() => onJump({ section: "chats", filter: "open" })} />}>
        <SimpleList items={recentChats} emptyLabel="Sohbet yok" renderItem={(item) => <ThreadRow item={item} />} />
      </Card>

      <Card title={<CardLinkTitle label="İade kuyruğu" onClick={() => onJump({ section: "refunds", filter: "pending" })} />}>
        <SimpleList
          items={recentRefunds}
          emptyLabel="Bekleyen iade yok"
          renderItem={(item) => (
            <ListRow
              title={item.productId || "İade"}
              subtitle={formatDate(item.eventTimestamp || item.createdAt, true)}
              value={item.deviceId || "-"}
            />
          )}
        />
      </Card>

      <Card title={<CardLinkTitle label="Kripto ödemeler" onClick={() => onJump({ section: "crypto", filter: "all" })} />}>
        <SimpleList
          items={recentCrypto}
          emptyLabel="Kayıt yok"
          renderItem={(item) => (
            <ListRow
              title={item.productId || item.orderId || "Ödeme"}
              subtitle={humanizeCryptoStatus(item.status)}
              value={formatMoney(item.priceAmount || item.payAmount, item.priceCurrency || item.payCurrency)}
            />
          )}
        />
      </Card>

      <Card title={<CardLinkTitle label="Yeni cihazlar" onClick={() => onJump({ section: "devices", filter: "all" })} />}>
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
  const isMobileDetail = isMobile && stage === "detail";
  const detailCardTitle = isMobileDetail ? null : selectedThread?.subject || "Sohbet";
  const detailHeaderActions =
    isMobile && !isMobileDetail ? (
      <button className="text-button active" type="button" onClick={() => setStage("list")}>
        Liste
      </button>
    ) : null;

  return (
    <section className={`section-stack ${isMobileDetail ? "chat-detail-screen" : ""}`.trim()}>
      {!isMobileDetail ? (
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
      ) : null}

      <div className="workspace-grid chats-grid compact-grid">
        {showList ? (
          <Card title={isMobile ? null : "Sohbetler"}>
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
            title={detailCardTitle}
            headerActions={detailHeaderActions}
            className={isMobileDetail ? "chat-detail-card" : ""}
          >
            {selectedThread ? (
              <div className={`conversation-shell ${isMobileDetail ? "mobile-conversation-shell" : ""}`.trim()}>
                {!isMobileDetail ? (
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
                ) : null}

                <div className={`messages ${isMobileDetail ? "mobile-messages" : ""}`.trim()}>
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
                          <div className="message-footer">
                            <div className="message-time">{formatDate(message.createdAt, true)}</div>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <EmptyCard label="Mesaj yok." />
                  )}
                  <div ref={messagesEndRef} />
                </div>

                <form className={`composer ${isMobileDetail ? "mobile-composer" : ""}`.trim()} onSubmit={sendMessage}>
                  <input
                    type="text"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Mesaj yaz"
                    disabled={selectedThread.status === CLOSED_CHAT_STATUS}
                  />
                  <button
                    className={`primary-button ${isMobileDetail ? "composer-send-button" : ""}`.trim()}
                    type="submit"
                    disabled={isSending || selectedThread.status === CLOSED_CHAT_STATUS || !draft.trim()}
                    aria-label="Gönder"
                  >
                    {isMobileDetail ? <AppIcon name="send" /> : isSending ? "..." : "Gönder"}
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
          <Card title={isMobile ? null : "İadeler"}>
            <SimpleList
              items={refunds}
              emptyLabel="İade yok"
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
                  title={item.productId || "İade"}
                  subtitle={`${REFUND_STATUS_LABELS[item.status] || "Bekliyor"} · ${formatDate(item.eventTimestamp || item.createdAt, true)}`}
                  value={item.deviceId || item.appUserId || "-"}
                />
              )}
            />
          </Card>
        ) : null}

        {showDetail ? (
          <Card
            title={selectedRefund?.productId || "İade"}
            headerActions={
              isMobile ? (
                <button className="text-button active" type="button" onClick={() => setStage("list")}>
                  Liste
                </button>
              ) : null
            }
          >
            {selectedRefund ? (
              <div className="detail-stack">
                <SummaryGrid
                  rows={[
                    ["Durum", REFUND_STATUS_LABELS[selectedRefund.status] || "Bekliyor"],
                    ["İncelendi", selectedRefund.reviewed ? "Evet" : "Hayır"],
                    [
                      "Cihaz",
                      selectedRefund.deviceId ? (
                        <DeviceButton
                          deviceId={selectedRefund.deviceId}
                          onClick={() => onOpenDevice(selectedRefund.deviceId)}
                        />
                      ) : (
                        "-"
                      ),
                    ],
                    ["Uygulama kullanıcı", selectedRefund.appUserId || "-"],
                    ["İlk işlem", selectedRefund.originalTransactionId || "-"],
                    ["İşlem", selectedRefund.transactionId || "-"],
                    ["Mağaza", selectedRefund.store || "-"],
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
              <EmptyCard label="Bir iade seç." />
            )}
          </Card>
        ) : null}
      </div>
    </section>
  );
}

function SalesSection({
  isMobile,
  purchases,
  selectedPurchaseId,
  selectedPurchaseIds,
  setSelectedPurchaseId,
  onOpenPurchase,
  onToggleSelection,
  onToggleAllSelections,
  onDeleteSelected,
  filter,
  setFilter,
  packagePrices,
}) {
  const allSelected =
    purchases.length > 0 && purchases.every((item) => selectedPurchaseIds.includes(item.id));

  return (
    <section className="section-stack">
      <div className="pill-row">
        {[
          { id: "today", label: "Bugün" },
          { id: "yesterday", label: "Dün" },
          { id: "all", label: "Tümü" },
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

      <Card
        title={isMobile ? null : "Satışlar"}
        headerActions={!isMobile ? (
          <button
            className="danger-button compact-button"
            type="button"
            onClick={onDeleteSelected}
            disabled={!selectedPurchaseIds.length}
          >
            Seçileni sil{selectedPurchaseIds.length ? ` (${selectedPurchaseIds.length})` : ""}
          </button>
        ) : null}
      >
        <DataTable
          mobileCards={isMobile}
          showMobileToolbar={!isMobile}
          emptyLabel="Satış yok"
          columns={[
            { key: "product", label: "Ürün" },
            { key: "device", label: "Cihaz" },
            { key: "store", label: "Mağaza" },
            { key: "price", label: "Tutar", align: "right" },
            { key: "date", label: "Tarih", align: "right" },
          ]}
          rows={purchases}
          selectedId={selectedPurchaseId}
          onSelect={(item) => {
            setSelectedPurchaseId(item.id);
            onOpenPurchase(item.id);
          }}
          selection={{
            allSelected,
            selectedIds: selectedPurchaseIds,
            onToggleAll: onToggleAllSelections,
            onToggleRow: onToggleSelection,
          }}
          renderRow={(item) => ({
            product: item.productId || "Ürün",
            device: item.deviceId || "-",
            store: item.store || item.source || "-",
            price: formatCatalogPrice(item.productId, packagePrices, item.price, item.currency),
            date: formatDate(item.purchasedAt || item.processedAt || item.updatedAt),
          })}
        />
      </Card>
    </section>
  );
}

function CryptoSection({
  isMobile,
  payments,
  selectedPaymentId,
  selectedPaymentIds,
  setSelectedPaymentId,
  onOpenPayment,
  onToggleSelection,
  onToggleAllSelections,
  onDeleteSelected,
  filter,
  setFilter,
  dateFilter,
  setDateFilter,
}) {
  const allSelected =
    payments.length > 0 && payments.every((item) => selectedPaymentIds.includes(item.id));

  return (
    <section className="section-stack">
      <div className="pill-row">
        {[
          { id: "all", label: "Tümü" },
          { id: "uncredited", label: "Kredisi verilmedi" },
          { id: "credited", label: "Kredi verildi" },
          { id: "pending", label: "Bekliyor" },
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

      <div className="pill-row">
        {[
          { id: "today", label: "Bugün" },
          { id: "yesterday", label: "Dün" },
          { id: "all", label: "Tümü" },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            className={`pill-button ${dateFilter === item.id ? "active" : ""}`}
            onClick={() => setDateFilter(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <Card
        title={isMobile ? null : "Kripto"}
        headerActions={!isMobile ? (
          <button
            className="danger-button compact-button"
            type="button"
            onClick={onDeleteSelected}
            disabled={!selectedPaymentIds.length}
          >
            Seçileni sil{selectedPaymentIds.length ? ` (${selectedPaymentIds.length})` : ""}
          </button>
        ) : null}
      >
        <DataTable
          mobileCards={isMobile}
          showMobileToolbar={!isMobile}
          emptyLabel="Ödeme yok"
          columns={[
            { key: "product", label: "Paket" },
            { key: "device", label: "Cihaz" },
            { key: "status", label: "Durum" },
            { key: "price", label: "Tutar", align: "right" },
            { key: "date", label: "Tarih", align: "right" },
          ]}
          rows={payments}
          selectedId={selectedPaymentId}
          onSelect={(item) => {
            setSelectedPaymentId(item.id);
            onOpenPayment(item.id);
          }}
          selection={{
            allSelected,
            selectedIds: selectedPaymentIds,
            onToggleAll: onToggleAllSelections,
            onToggleRow: onToggleSelection,
          }}
          renderRow={(item) => ({
            product: item.productId || item.orderId || "Ödeme",
            device: item.deviceId || "-",
            status: humanizeCryptoStatus(item.status),
            price: formatMoney(item.priceAmount || item.payAmount, item.priceCurrency || item.payCurrency),
            date: formatDate(item.updatedAt || item.createdAt),
          })}
        />
      </Card>
    </section>
  );
}

function DevicesSection({
  isMobile,
  devices,
  selectedDeviceId,
  setSelectedDeviceId,
  onOpenDevice,
  filter,
  setFilter,
  rewardFilter,
  setRewardFilter,
  dateFilter,
  setDateFilter,
}) {
  return (
    <section className="section-stack">
      <div className="pill-row">
        {[
          { id: "all", label: "Tümü" },
          { id: "banned", label: "Banlı" },
          { id: "subscribed", label: "Abone" },
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

      <div className="pill-row">
        {[
          { id: "all", label: "Ödül: Tümü" },
          { id: "rewarded", label: "Ödül: Evet" },
          { id: "not_rewarded", label: "Ödül: Hayır" },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            className={`pill-button ${rewardFilter === item.id ? "active" : ""}`}
            onClick={() => setRewardFilter(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="pill-row">
        {[
          { id: "today", label: "Bugün" },
          { id: "yesterday", label: "Dün" },
          { id: "all", label: "Tümü" },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            className={`pill-button ${dateFilter === item.id ? "active" : ""}`}
            onClick={() => setDateFilter(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <Card title={isMobile ? null : "Cihazlar"}>
        <DataTable
          mobileCards={isMobile}
          emptyLabel="Cihaz yok"
          columns={[
            { key: "mail", label: "Mail" },
            { key: "device", label: "Cihaz" },
            { key: "credits", label: "Kredi", align: "right" },
            { key: "subscription", label: "Abone" },
            { key: "reward", label: "Ödül" },
            { key: "ban", label: "Ban" },
            { key: "date", label: "Tarih", align: "right" },
          ]}
          rows={devices}
          selectedId={selectedDeviceId}
          onSelect={(item) => {
            const resolvedId = item.deviceId || item.id;
            setSelectedDeviceId(resolvedId);
            onOpenDevice(resolvedId);
          }}
          renderRow={(item) => ({
            mail: item.mail || "-",
            device: item.deviceId || item.id || "-",
            credits: String(safeNumber(item.credits)),
            subscription: item.hasSubscription ? "Var" : "Yok",
            reward: (
              <span className={`reward-chip ${item.hasClaimedRatingReward ? "reward-yes" : "reward-no"}`.trim()}>
                {item.hasClaimedRatingReward ? "Evet" : "Hayır"}
              </span>
            ),
            ban: item.ban || item.isBanned ? "Evet" : "Hayır",
            date: formatDate(item.updatedAt || item.createdAt),
          })}
        />
      </Card>
    </section>
  );
}

function SettingsSection({
  docs,
  drafts,
  isSaving,
  setFlatValue,
  setNestedValue,
  setDocValue,
  saveDoc,
  reportError,
}) {
  const [fieldModal, setFieldModal] = useState(null);
  const [productModal, setProductModal] = useState(null);
  const [activeDocId, setActiveDocId] = useState(SETTINGS_DOCS[0]?.id || "app");

  const deleteProductRow = (docId, rowKey) => {
    const currentDoc = { ...(drafts[docId] || docs[docId] || {}) };
    delete currentDoc[rowKey];
    setDocValue(docId, currentDoc);
  };

  const updateProductField = (docId, productKey, fieldKey, nextValue) => {
    setNestedValue(docId, [productKey, fieldKey], nextValue);
  };

  const openFieldModal = (docId) => {
    setFieldModal({
      docId,
      key: "",
      type: "string",
      value: "",
    });
  };

  const saveFieldModal = () => {
    if (!fieldModal) {
      return;
    }

    const normalizedKey = fieldModal.key.trim();
    if (!normalizedKey) {
      reportError?.("Alan adı gir.");
      return;
    }

    const currentDoc = drafts[fieldModal.docId] || docs[fieldModal.docId] || {};
    if (Object.prototype.hasOwnProperty.call(currentDoc, normalizedKey)) {
      reportError?.("Bu alan zaten var.");
      return;
    }

    setFlatValue(
      fieldModal.docId,
      normalizedKey,
      parseTypedValue(fieldModal.type, fieldModal.value)
    );
    setFieldModal(null);
  };

  const openProductModal = (docId) => {
    const currentDoc = drafts[docId] || docs[docId] || {};
    setProductModal({
      docId,
      key: "",
      fields: inferProductFieldDrafts(docId, currentDoc),
    });
  };

  const saveProductModal = () => {
    if (!productModal) {
      return;
    }

    const normalizedKey = productModal.key.trim();
    if (!normalizedKey) {
      reportError?.("Ürün anahtarı gir.");
      return;
    }

    const currentDoc = drafts[productModal.docId] || docs[productModal.docId] || {};
    if (Object.prototype.hasOwnProperty.call(currentDoc, normalizedKey)) {
      reportError?.("Bu ürün zaten var.");
      return;
    }

    const nextRow = productModal.fields.reduce((accumulator, field) => {
      const fieldKey = field.key.trim();
      if (!fieldKey) {
        return accumulator;
      }

      accumulator[fieldKey] = parseTypedValue(field.type, field.value);
      return accumulator;
    }, {});

    setDocValue(productModal.docId, {
      ...currentDoc,
      [normalizedKey]: nextRow,
    });
    setProductModal(null);
  };

  return (
    <>
      <section className="section-stack">
        <div className="tab-row settings-tab-row">
          {SETTINGS_DOCS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`tab-button ${activeDocId === item.id ? "active" : ""}`}
              onClick={() => setActiveDocId(item.id)}
            >
              {item.title}
            </button>
          ))}
        </div>

        <div className="settings-grid settings-grid-single">
        {SETTINGS_DOCS.filter((item) => item.id === activeDocId).map((item) => (
          <Card
            key={item.id}
            title={item.title}
            headerActions={
              <div className="card-actions">
                <button
                  className="ghost-button compact-button"
                  type="button"
                  onClick={() =>
                    item.type === "flat" ? openFieldModal(item.id) : openProductModal(item.id)
                  }
                >
                  {item.type === "flat" ? "Yeni alan" : "Yeni ürün"}
                </button>
                <button
                  type="button"
                  className={`text-button ${hasSettingsChanges(drafts[item.id], docs[item.id]) ? "active" : ""}`.trim()}
                  onClick={() => saveDoc(item.id)}
                  disabled={!hasSettingsChanges(drafts[item.id], docs[item.id]) || isSaving[item.id]}
                >
                  {isSaving[item.id] ? "Kaydediliyor..." : "Kaydet"}
                </button>
              </div>
            }
            className="settings-card"
          >
            {item.type === "flat" ? (
              <div className="settings-fields">
                {Object.entries(drafts[item.id] || docs[item.id] || {})
                  .sort(([left], [right]) => left.localeCompare(right))
                  .map(([key, value]) => (
                    <SettingField
                      key={key}
                      label={formatSettingLabel(key)}
                      value={value}
                      onChange={(nextValue) => setFlatValue(item.id, key, nextValue)}
                    />
                  ))}
              </div>
            ) : (
              <ProductMatrixEditor
                docId={item.id}
                value={drafts[item.id] || docs[item.id] || {}}
                onDeleteRow={deleteProductRow}
                onChange={updateProductField}
              />
            )}
          </Card>
        ))}
        </div>
      </section>

      <CenterModal
        isOpen={Boolean(fieldModal)}
        title="Yeni alan"
        onClose={() => setFieldModal(null)}
        footer={
          <>
            <button className="ghost-button compact-button" type="button" onClick={() => setFieldModal(null)}>
              Vazgeç
            </button>
            <button className="primary-button compact-button" type="button" onClick={saveFieldModal}>
              Ekle
            </button>
          </>
        }
      >
        {fieldModal ? (
          <div className="modal-form">
            <label>
              <span>Alan adı</span>
              <input
                type="text"
                value={fieldModal.key}
                onChange={(event) =>
                  setFieldModal((current) => ({ ...current, key: event.target.value }))
                }
                placeholder="ör. telegramBotToken"
              />
            </label>

            <label>
              <span>Tip</span>
              <select
                value={fieldModal.type}
                onChange={(event) =>
                  setFieldModal((current) => ({
                    ...current,
                    type: event.target.value,
                    value: event.target.value === "boolean" ? "false" : current?.value || "",
                  }))
                }
              >
                <option value="string">String</option>
                <option value="number">Number</option>
                <option value="boolean">Bool</option>
              </select>
            </label>

            <FieldValueEditor
              label="Değer"
              type={fieldModal.type}
              value={fieldModal.value}
              onChange={(nextValue) =>
                setFieldModal((current) => ({ ...current, value: nextValue }))
              }
            />
          </div>
        ) : null}
      </CenterModal>

      <CenterModal
        isOpen={Boolean(productModal)}
        title="Yeni ürün"
        onClose={() => setProductModal(null)}
        footer={
          <>
            <button className="ghost-button compact-button" type="button" onClick={() => setProductModal(null)}>
              Vazgeç
            </button>
            <button className="primary-button compact-button" type="button" onClick={saveProductModal}>
              Ekle
            </button>
          </>
        }
      >
        {productModal ? (
          <div className="modal-form">
            <label>
              <span>Ürün anahtarı</span>
              <input
                type="text"
                value={productModal.key}
                onChange={(event) =>
                  setProductModal((current) => ({ ...current, key: event.target.value }))
                }
                placeholder={
                  productModal.docId === "products"
                    ? "ör. com.isms.product6"
                    : "ör. product5"
                }
              />
            </label>

            <div className="modal-field-stack">
              {productModal.fields.map((field, index) => (
                <div className="modal-inline-grid" key={`${field.key}-${index}`}>
                  <label>
                    <span>Alan</span>
                    <input type="text" value={field.key} readOnly />
                  </label>
                  <label>
                    <span>Tip</span>
                    <select
                      value={field.type}
                      onChange={(event) =>
                        setProductModal((current) => ({
                          ...current,
                          fields: current.fields.map((item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  type: event.target.value,
                                  value:
                                    event.target.value === "boolean"
                                      ? "false"
                                      : item.value,
                                }
                              : item
                          ),
                        }))
                      }
                    >
                      <option value="string">String</option>
                      <option value="number">Number</option>
                      <option value="boolean">Bool</option>
                    </select>
                  </label>
                  <FieldValueEditor
                    label="Değer"
                    type={field.type}
                    value={field.value}
                    onChange={(nextValue) =>
                      setProductModal((current) => ({
                        ...current,
                        fields: current.fields.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, value: nextValue } : item
                        ),
                      }))
                    }
                  />
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CenterModal>
    </>
  );
}

function SettingsAccessGate({ email, password, onPasswordChange, onSubmit }) {
  return (
    <section className="section-stack">
      <Card title="Ayarlar">
        <form className="access-gate" onSubmit={onSubmit}>
          <div className="access-copy">
            <strong>Ek doğrulama gerekli</strong>
            <span>{email}</span>
          </div>

          <label>
            <span>Şifre</span>
            <input
              type="password"
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              placeholder="Ayarlar şifresi"
              autoComplete="current-password"
            />
          </label>

          <button className="primary-button" type="submit">
            Devam et
          </button>
        </form>
      </Card>
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
  const [activeTab, setActiveTab] = useState("orders");

  useEffect(() => {
    if (isOpen) {
      setActiveTab("orders");
    }
  }, [device?.deviceId, device?.id, isOpen]);

  if (!isOpen || !device) {
    return null;
  }

  const isBanned = Boolean(device.ban || device.isBanned);
  const pendingCrypto = cryptoPayments.filter(
    (item) => !CRYPTO_SUCCESS_STATUSES.has(normalize(item.status))
  );
  const lastPurchase = purchases[0];
  const lastCrypto = cryptoPayments[0];
  const lastThread = threads[0];

  return (
    <SideSheet
      isMobile={isMobile}
      title={device.mail || device.deviceId || "Kullanıcı"}
      subtitle={device.deviceId || device.id || "-"}
      onClose={onClose}
    >
      <div className="drawer-top">
        <div className="drawer-section compact-section compact-sheet-card">
          <h3>Genel</h3>
          <InfoStack
            rows={[
              {
                label: "Mail",
                value: device.mail || "-",
                action:
                  device.mail
                    ? {
                        label: "Kopyala",
                        onClick: () => copyText(device.mail),
                      }
                    : null,
              },
              {
                label: "Cihaz",
                value: device.deviceId || device.id || "-",
              },
              {
                label: "Apple User",
                value: device.appleUserID || "-",
              },
            ]}
          />
          <MiniStatGrid
            rows={[
              {
                label: "Kredi",
                value: String(safeNumber(device.credits)),
              },
              {
                label: "Abonelik",
                value: device.hasSubscription ? "Var" : "Yok",
              },
              {
                label: "Ban",
                value: isBanned ? "Evet" : "Hayır",
              },
              {
                label: "Referral",
                value: device.referralCode || "-",
              },
            ]}
          />
          <div className="mini-action-row">
            <button
              className="ghost-button compact-button"
              type="button"
              onClick={() => copyText(device.deviceId || device.id || "")}
            >
              ID kopyala
            </button>
          </div>
        </div>

        <div className="drawer-section compact-section compact-sheet-card">
          <h3>Son aktivite</h3>
          <InfoStack
            rows={[
              {
                label: "Son satış",
                value: lastPurchase
                  ? formatDate(lastPurchase.updatedAt || lastPurchase.purchasedAt)
                  : "-",
              },
              {
                label: "Son kripto",
                value: lastCrypto
                  ? formatDate(lastCrypto.updatedAt || lastCrypto.createdAt)
                  : "-",
              },
              {
                label: "Son destek",
                value: lastThread
                  ? formatDate(lastThread.updatedAt || lastThread.createdAt)
                  : "-",
              },
            ]}
          />
        </div>

        <div className="drawer-section compact-section compact-sheet-card">
          <h3>İşlemler</h3>
          <div className="action-grid compact-actions">
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
      </div>

      <div className="tab-row drawer-tab-row">
        {DEVICE_DRAWER_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`tab-button ${activeTab === item.id ? "active" : ""}`}
            onClick={() => setActiveTab(item.id)}
          >
            {item.label}
            <span>{item.id === "orders" ? orders.length : item.id === "sales" ? purchases.length : item.id === "crypto" ? cryptoPayments.length : threads.length + refunds.length}</span>
          </button>
        ))}
      </div>

      {activeTab === "orders" ? (
        <DrawerGroup
          title={null}
          emptyLabel="Numara yok"
          items={orders}
          renderItem={(item) => (
            <div className="row-content">
              <div className="row-copy">
                <strong>{item.phoneNumber || "-"}</strong>
                <span>
                  {`${item.countryFlag || ""} ${item.serviceName || "Servis"}`.trim()} · {humanizeOrderStatus(item.status)} · {formatDate(item.createdAt)}
                </span>
              </div>
              {hasOrderSms(item) ? (
                <div className="row-value-stack">
                  <span className="sms-indicator">{orderSmsIndicatorText(item)}</span>
                </div>
              ) : (
                <div className="row-value-stack">
                  <span className="row-value">{formatDate(item.createdAt)}</span>
                </div>
              )}
            </div>
          )}
        />
      ) : null}

      {activeTab === "sales" ? (
        <DrawerGroup
          title={null}
          emptyLabel="Satın alma yok"
          items={purchases}
          interactive
          onSelect={(item) => onOpenPurchase(item.id)}
          renderItem={(item) => (
            <ListRow
              title={item.productId || "Ürün"}
              subtitle={`${item.store || item.source || "-"} · ${formatDate(item.purchasedAt || item.processedAt || item.updatedAt)}`}
              value={formatMoney(item.price, item.currency)}
            />
          )}
        />
      ) : null}

      {activeTab === "crypto" ? (
        <>
          <div className="drawer-section compact-section">
            <SummaryGrid
              rows={[
                ["Toplam", String(cryptoPayments.length)],
                ["Bekleyen", String(pendingCrypto.length)],
                ["Tamamlanan", String(cryptoPayments.length - pendingCrypto.length)],
              ]}
            />
          </div>
          <DrawerGroup
            title={null}
            emptyLabel="Kripto ödeme yok"
            items={cryptoPayments}
            interactive
            onSelect={(item) => onOpenCrypto(item.id)}
            renderItem={(item) => (
              <ListRow
                title={item.productId || item.orderId || "Ödeme"}
                subtitle={`${humanizeCryptoStatus(item.status)} · ${formatDate(item.updatedAt || item.createdAt)}`}
                value={formatMoney(item.priceAmount || item.payAmount, item.priceCurrency || item.payCurrency)}
              />
            )}
          />
        </>
      ) : null}

      {activeTab === "history" ? (
        <>
          <DrawerGroup
            title="Destek geçmişi"
            emptyLabel="Sohbet yok"
            items={threads}
            interactive
            onSelect={(item) => onOpenThread(item.id)}
            renderItem={(item) => <ThreadRow item={item} />}
          />

          <DrawerGroup
            title="İadeler"
            emptyLabel="İade yok"
            items={refunds}
            renderItem={(item) => (
              <ListRow
                title={item.productId || "İade"}
                subtitle={`${REFUND_STATUS_LABELS[item.status] || "Bekliyor"} · ${formatDate(item.eventTimestamp || item.createdAt, true)}`}
                value={item.transactionId || "-"}
              />
            )}
          />
        </>
      ) : null}
    </SideSheet>
  );
}

function PurchaseDrawer({ isMobile, purchase, isOpen, onClose, onOpenDevice, onDelete }) {
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
      <div className="detail-stack">
        <SummaryGrid
          rows={[
            [
              "Cihaz",
              purchase.deviceId ? (
                <DeviceButton deviceId={purchase.deviceId} onClick={() => onOpenDevice(purchase.deviceId)} />
              ) : (
                "-"
              ),
            ],
            ["Mağaza", purchase.store || "-"],
            ["Kaynak", purchase.source || "-"],
            ["Paket fiyatı", formatCatalogPrice(purchase.productId, IOS_PACKAGE_USD_PRICES, purchase.price, purchase.currency)],
            ["Ödenen tutar", formatMoney(purchase.price, purchase.currency)],
            ["İşlem", purchase.transactionId || "-"],
            ["İlk işlem", purchase.originalTransactionId || "-"],
            ["Krediler", String(purchase.creditsGranted ?? "-")],
            ["Bakiye sonrası", String(purchase.creditsBalanceAfter ?? "-")],
            ["Test", purchase.isSandbox ? "Evet" : "Hayır"],
            ["Tarih", formatDate(purchase.purchasedAt || purchase.processedAt || purchase.updatedAt)],
          ]}
        />

        <button
          className="danger-button wide-button"
          type="button"
          onClick={() => {
            if (window.confirm("Bu satış kaydını silmek istiyor musun?")) {
              onDelete?.(purchase.id);
            }
          }}
        >
          Satışı sil
        </button>
      </div>
    </SideSheet>
  );
}

function CryptoDrawer({
  isMobile,
  payment,
  isOpen,
  onClose,
  onOpenDevice,
  onGrantCredits,
  isApplyingCredits,
}) {
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
      <div className="detail-stack">
        <InfoStack
          rows={[
            {
              label: "Cihaz",
              value: payment.deviceId ? (
                <DeviceButton
                  deviceId={payment.deviceId}
                  onClick={() => onOpenDevice(payment.deviceId)}
                />
              ) : (
                "-"
              ),
            },
            { label: "Order", value: payment.orderId || "-" },
            { label: "Durum", value: humanizeCryptoStatus(payment.status) },
            { label: "Krediler", value: String(payment.totalCredits ?? payment.credits ?? "-") },
            {
              label: "Tutar",
              value: formatMoney(
                payment.priceAmount,
                payment.priceCurrency || payment.payCurrency
              ),
            },
            {
              label: "Ödenen",
              value: formatMoney(
                payment.payAmount,
                payment.payCurrency || payment.priceCurrency
              ),
            },
            { label: "Fatura", value: payment.providerInvoiceId || "-" },
            { label: "Ödeme ID", value: payment.providerPaymentId || "-" },
            { label: "Kredi verildi", value: hasGrantedCryptoCredits(payment) ? "Evet" : "Hayır" },
            { label: "Tarih", value: formatDate(payment.updatedAt || payment.createdAt) },
          ]}
        />

        {normalize(payment.status) === "partially_paid" && !hasGrantedCryptoCredits(payment) ? (
          <button
            className="primary-button wide-button"
            type="button"
            onClick={onGrantCredits}
            disabled={isApplyingCredits}
          >
            {isApplyingCredits ? "İşleniyor..." : "Krediyi Ver"}
          </button>
        ) : null}
      </div>
    </SideSheet>
  );
}

function Card({
  title,
  headerActions,
  className = "",
  children,
}) {
  return (
    <section className={`surface-card ${className}`.trim()}>
      {title || headerActions ? (
        <div className="card-head">
          {title ? <h2>{title}</h2> : <div />}
          {headerActions ? <div className="card-actions">{headerActions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

function MetricCard({ label, value, meta, onClick }) {
  const toneClass = meta?.tone ? ` ${meta.tone}` : "";

  return (
    <button type="button" className={`metric-card interactive${toneClass}`} onClick={onClick}>
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{typeof meta === "string" ? meta : meta?.text}</em>
    </button>
  );
}

function CardLinkTitle({ label, onClick }) {
  return (
    <button type="button" className="card-link-title" onClick={onClick}>
      <span>{label}</span>
      <AppIcon name="chevronRight" />
    </button>
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

function DataTable({
  columns,
  rows,
  selectedId,
  onSelect,
  renderRow,
  emptyLabel,
  selection,
  mobileCards = false,
  showMobileToolbar = true,
}) {
  if (!rows.length) {
    return <EmptyCard label={emptyLabel} />;
  }

  if (mobileCards) {
    return (
      <div className="mobile-table-list">
        {selection && showMobileToolbar ? (
          <div className="mobile-table-toolbar">
            <button type="button" className="ghost-button compact-button" onClick={selection.onToggleAll}>
              {selection.allSelected ? "Seçimi temizle" : "Tümünü seç"}
            </button>
          </div>
        ) : null}

        {rows.map((row) => {
          const key = row.id || row.deviceId;
          const isSelected = selectedId === row.id || selectedId === row.deviceId;
          const cells = renderRow(row);
          const titleColumn = columns[0];
          const subtitleColumn = columns[1];
          const titleValue = titleColumn ? cells[titleColumn.key] : "-";
          const subtitleValue = subtitleColumn ? cells[subtitleColumn.key] : "";
          const detailColumns = columns.slice(2);

          return (
            <button
              type="button"
              key={key}
              className={`mobile-data-card ${isSelected ? "selected" : ""}`.trim()}
              onClick={() => onSelect?.(row)}
            >
              <div className="mobile-data-card-head">
                <div className="mobile-data-card-copy">
                  <strong>{titleValue ?? "-"}</strong>
                  {subtitleValue ? (
                    <span>
                      {subtitleColumn?.label}: {subtitleValue}
                    </span>
                  ) : null}
                </div>
                {selection ? (
                  <div className="mobile-data-card-check" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selection.selectedIds.includes(row.id)}
                      onChange={() => selection.onToggleRow(row.id)}
                      aria-label="Satırı seç"
                    />
                  </div>
                ) : null}
              </div>

              <div className="mobile-data-card-grid">
                {detailColumns.map((column) => (
                  <div className="mobile-data-card-row" key={column.key}>
                    <span>{column.label}</span>
                    <strong>{cells[column.key] ?? "-"}</strong>
                  </div>
                ))}
              </div>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="table-shell">
      <table className="data-table">
        <thead>
          <tr>
            {selection ? (
              <th className="checkbox-column">
                <input
                  type="checkbox"
                  checked={selection.allSelected}
                  onChange={selection.onToggleAll}
                  aria-label="Tümünü seç"
                />
              </th>
            ) : null}
            {columns.map((column) => (
              <th key={column.key} className={column.align === "right" ? "align-right" : ""}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = row.id || row.deviceId;
            const isSelected = selectedId === row.id || selectedId === row.deviceId;
            const cells = renderRow(row);

            return (
              <tr
                key={key}
                className={isSelected ? "selected" : ""}
                onClick={() => onSelect?.(row)}
              >
                {selection ? (
                  <td className="checkbox-column" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selection.selectedIds.includes(row.id)}
                      onChange={() => selection.onToggleRow(row.id)}
                      aria-label="Satırı seç"
                    />
                  </td>
                ) : null}
                {columns.map((column) => (
                  <td key={column.key} className={column.align === "right" ? "align-right" : ""}>
                    {cells[column.key] ?? "-"}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ProductMatrixEditor({ docId, value, onDeleteRow, onChange }) {
  const columns = useMemo(() => {
    const fieldSet = new Set();
    Object.values(value || {}).forEach((row) => {
      Object.keys(row || {}).forEach((field) => fieldSet.add(field));
    });
    const defaultOrder = DEFAULT_PRODUCT_SCHEMAS[docId]?.map((item) => item.key) || [];
    return Array.from(fieldSet).sort((left, right) => {
      const leftIndex = defaultOrder.indexOf(left);
      const rightIndex = defaultOrder.indexOf(right);

      if (leftIndex !== -1 || rightIndex !== -1) {
        if (leftIndex === -1) {
          return 1;
        }

        if (rightIndex === -1) {
          return -1;
        }

        return leftIndex - rightIndex;
      }

      return left.localeCompare(right);
    });
  }, [docId, value]);

  const rows = Object.entries(value || {}).sort(([left], [right]) => left.localeCompare(right));

  if (!rows.length) {
    return <EmptyCard label="Ürün yok" />;
  }

  return (
    <div className="settings-groups">
      <div className="table-shell">
        <table className="data-table settings-table">
          <thead>
            <tr>
              <th>Ürün</th>
              {columns.map((column) => (
                <th key={column}>{formatSettingLabel(column)}</th>
              ))}
              <th className="align-right">Sil</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([rowKey, rowValue]) => (
              <tr key={rowKey}>
                <td className="settings-row-key">{rowKey}</td>
                {columns.map((column) => (
                  <td key={column}>
                    <InlineValueInput
                      value={rowValue?.[column]}
                      onChange={(nextValue) => onChange(docId, rowKey, column, nextValue)}
                    />
                  </td>
                ))}
                <td className="align-right">
                  <button
                    className="table-delete icon-only"
                    type="button"
                    onClick={() => onDeleteRow(docId, rowKey)}
                    aria-label={`${rowKey} ürününü sil`}
                  >
                    <AppIcon name="trash" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FieldValueEditor({ label, type, value, onChange }) {
  return (
    <label>
      <span>{label}</span>
      {type === "boolean" ? (
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="false">false</option>
          <option value="true">true</option>
        </select>
      ) : (
        <input
          type={type === "number" ? "number" : "text"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Değer"
        />
      )}
    </label>
  );
}

function CenterModal({ isOpen, title, onClose, children, footer }) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-layer">
      <button className="modal-backdrop" type="button" onClick={onClose} aria-label="Kapat" />
      <div className="modal-card">
        <div className="modal-head">
          <h3>{title}</h3>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Kapat">
            <AppIcon name="close" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-footer">{footer}</div>
      </div>
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

function InfoStack({ rows }) {
  return (
    <div className="info-stack">
      {rows.map((row) => (
        <div className="info-row" key={row.label}>
          <div className="info-row-head">
            <span>{row.label}</span>
            {row.action ? (
              <button type="button" className="inline-copy-button" onClick={row.action.onClick}>
                {row.action.label}
              </button>
            ) : null}
          </div>
          <strong>{row.value}</strong>
        </div>
      ))}
    </div>
  );
}

function MiniStatGrid({ rows }) {
  return (
    <div className="mini-stat-grid">
      {rows.map((row) => (
        <div className="mini-stat-card" key={row.label}>
          <span>{row.label}</span>
          <strong>{row.value}</strong>
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
      {title ? <h3>{title}</h3> : null}
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

function SettingField({ label, value, onChange, compact = false }) {
  if (typeof value === "boolean") {
    return (
      <div className={`setting-row inline ${compact ? "compact" : ""}`.trim()}>
        <div className="setting-copy">
          <strong>{label}</strong>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={value}
          className={`switch-button ${value ? "active" : ""}`}
          onClick={() => onChange(!value)}
        >
          <span className="switch-track">
            <span className="switch-thumb" />
          </span>
        </button>
      </div>
    );
  }

  const inputType = typeof value === "number" ? "number" : "text";

  return (
    <label className={`setting-row ${compact ? "compact" : ""}`.trim()}>
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

function InlineValueInput({ value, onChange }) {
  if (typeof value === "boolean") {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={value}
        className={`switch-button ${value ? "active" : ""}`}
        onClick={() => onChange(!value)}
      >
        <span className="switch-track">
          <span className="switch-thumb" />
        </span>
      </button>
    );
  }

  const inputType = typeof value === "number" ? "number" : "text";

  return (
    <input
      className="table-input"
      type={inputType}
      value={value ?? ""}
      onChange={(event) => {
        if (typeof value === "number") {
          onChange(Number(event.target.value || 0));
          return;
        }
        onChange(event.target.value);
      }}
    />
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
    chevronLeft: "M15 6l-6 6 6 6",
    chevronRight: "M9 6l6 6-6 6",
    send: "M4 12 19 5l-3 14-4.5-4L4 12Zm7.5 3L19 5",
    trash: "M9 4h6m-8 3h10m-9 0 .6 11.2A2 2 0 0 0 10.6 20h2.8a2 2 0 0 0 2-1.8L16 7M10 10v6m4-6v6",
    selectionOn: "M5 5h14v14H5zM9 12l2 2 4-4",
    selectionOff: "M5 5h14v14H5zM9 9l6 6m0-6-6 6",
  };

  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name]} />
    </svg>
  );
}

function sectionTitle(section) {
  return NAV_ITEMS.find((item) => item.id === section)?.label || "Genel";
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
  const todayRevenue = todayPurchases.reduce((sum, item) => sum + getCatalogPriceValue(item.productId, item.price), 0);
  const totalRevenue = purchases.reduce((sum, item) => sum + getCatalogPriceValue(item.productId, item.price), 0);
  const openChats = threads.filter((thread) => thread.status !== CLOSED_CHAT_STATUS).length;
  const cryptoCompleted = cryptoPayments.filter((item) =>
    CRYPTO_SUCCESS_STATUSES.has(normalize(item.status))
  ).length;
  const uncreditedCrypto = cryptoPayments.filter(
    (item) => normalize(item.status) === "partially_paid" && !hasGrantedCryptoCredits(item)
  ).length;
  const activeSubscriptions = devices.filter((item) => item.hasSubscription).length;
  const bannedDevices = devices.filter((item) => item.ban || item.isBanned).length;

  return [
    {
      label: "Bugün gelir",
      value: formatMoney(todayRevenue, "USD"),
      meta: { text: `${todayPurchases.length} satış`, tone: "neutral" },
      raw: todayRevenue,
      target: { section: "sales", filter: "today" },
    },
    {
      label: "Toplam gelir",
      value: formatMoney(totalRevenue, "USD"),
      meta: { text: `${purchases.length} işlem`, tone: "neutral" },
      raw: totalRevenue,
      target: { section: "sales", filter: "all" },
    },
    {
      label: "Açık sohbet",
      value: String(openChats),
      meta: { text: `${threads.length} toplam`, tone: openChats > 0 ? "danger" : "success" },
      raw: openChats,
      target: { section: "chats", filter: "open" },
    },
    {
      label: "Kripto ödeme",
      value: String(cryptoCompleted),
      meta: { text: `${cryptoPayments.length} kayıt`, tone: "neutral" },
      raw: cryptoCompleted,
      target: { section: "crypto", filter: "credited" },
    },
    {
      label: "Bekleyen iade",
      value: String(refunds.filter((item) => !item.reviewed).length),
      meta: { text: `${refunds.length} toplam`, tone: refunds.filter((item) => !item.reviewed).length > 0 ? "danger" : "neutral" },
      raw: refunds.filter((item) => !item.reviewed).length,
      target: { section: "refunds", filter: "pending" },
    },
    {
      label: "Aktif abone",
      value: String(activeSubscriptions),
      meta: { text: `${devices.length} cihaz`, tone: "neutral" },
      raw: activeSubscriptions,
      target: { section: "devices", filter: "subscribed" },
    },
    {
      label: "Banlı cihaz",
      value: String(bannedDevices),
      meta: { text: "Güvenlik", tone: bannedDevices > 0 ? "danger" : "neutral" },
      raw: bannedDevices,
      target: { section: "devices", filter: "banned" },
    },
    {
      label: "Kredisi verilmemiş",
      value: String(uncreditedCrypto),
      meta: { text: "Kripto", tone: uncreditedCrypto > 0 ? "danger" : "neutral" },
      raw: uncreditedCrypto,
      target: { section: "crypto", filter: "uncredited" },
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

  return cloneDraft(data || {});
}

function cloneDraft(data) {
  return JSON.parse(JSON.stringify(data || {}));
}

function hasSettingsChanges(draft, original) {
  return JSON.stringify(draft || {}) !== JSON.stringify(original || {});
}

function updateNestedDraft(target, path, nextValue) {
  const draft = cloneDraft(target);
  let cursor = draft;

  path.forEach((segment, index) => {
    const isLast = index === path.length - 1;
    if (isLast) {
      cursor[segment] = nextValue;
      return;
    }

    cursor[segment] = cursor[segment] ? { ...cursor[segment] } : {};
    cursor = cursor[segment];
  });

  return draft;
}

function formatSettingLabel(value) {
  if (SETTING_LABELS[value]) {
    return SETTING_LABELS[value];
  }

  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTypedValue(type, rawValue) {
  if (type === "number") {
    return Number(rawValue || 0);
  }

  if (type === "boolean") {
    return normalize(rawValue) === "true";
  }

  return rawValue;
}

function buildEmptyProductRow(currentDoc) {
  const template = Object.values(currentDoc || {})[0] || {};
  const result = {};

  Object.entries(template).forEach(([key, value]) => {
    if (typeof value === "number") {
      result[key] = 0;
      return;
    }

    if (typeof value === "boolean") {
      result[key] = false;
      return;
    }

    result[key] = "";
  });

  if (!Object.keys(result).length) {
    result.price = 0;
  }

  return result;
}

function inferProductFieldDrafts(docId, currentDoc) {
  const template = buildEmptyProductRow(currentDoc);
  const entries = Object.entries(template);

  if (!entries.length && DEFAULT_PRODUCT_SCHEMAS[docId]) {
    return DEFAULT_PRODUCT_SCHEMAS[docId].map((item) => ({ ...item }));
  }

  return entries.map(([key, value]) => ({
    key,
    type: inferValueType(value),
    value: stringifyTypedValue(value),
  }));
}

function inferValueType(value) {
  if (typeof value === "number") {
    return "number";
  }

  if (typeof value === "boolean") {
    return "boolean";
  }

  return "string";
}

function stringifyTypedValue(value) {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number") {
    return String(value);
  }

  return value ?? "";
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

function humanizeCryptoStatus(status) {
  switch (normalize(status)) {
    case "finished":
    case "confirmed":
      return "Tamamlandı";
    case "partially_paid":
      return "Eksik ödendi";
    case "waiting":
    case "pending":
      return "Bekliyor";
    case "failed":
      return "Başarısız";
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
      : { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }
  ).format(date);
}

function formatMoney(amount, currency) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return "-";

  const normalizedCurrency = String(currency || "USD").trim().toUpperCase();

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: normalizedCurrency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    const formattedValue = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: value < 1 ? 2 : 0,
      maximumFractionDigits: 8,
    }).format(value);

    return normalizedCurrency ? `${formattedValue} ${normalizedCurrency}` : formattedValue;
  }
}

function getCatalogPriceValue(productId, fallbackAmount) {
  return IOS_PACKAGE_USD_PRICES[productId] ?? safeMoney(fallbackAmount);
}

function formatCatalogPrice(productId, packagePrices, fallbackAmount, fallbackCurrency) {
  const mappedValue = packagePrices?.[productId];
  if (mappedValue) {
    return formatMoney(mappedValue, "USD");
  }

  return formatMoney(fallbackAmount, fallbackCurrency);
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

async function copyText(value) {
  if (!value || typeof navigator === "undefined" || !navigator.clipboard) {
    return;
  }

  try {
    await navigator.clipboard.writeText(value);
  } catch {
    return;
  }
}

async function writeAdminLog({ user, operatorName, action, targetId, payload = {} }) {
  if (!user) {
    return;
  }

  await addDoc(collection(db, "adminLogs"), {
    action,
    targetId: targetId || "",
    payload,
    operatorId: user.uid,
    operatorEmail: user.email || "",
    operatorName: operatorName || "",
    createdAt: serverTimestamp(),
  });
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
