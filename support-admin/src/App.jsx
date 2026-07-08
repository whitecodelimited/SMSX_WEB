import { useEffect, useMemo, useRef, useState } from "react";
import {
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { auth, db } from "./firebase";

const STATUS_LABELS = {
  waiting_support: "User yazdi",
  waiting_user: "Destek yazdi",
  closed: "Kapali",
};

const SUPPORT_ALLOWED_EMAILS = (import.meta.env.VITE_SUPPORT_ALLOWED_EMAILS || "")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

const OPERATOR_NAME_STORAGE_KEY = "smsx_support_operator_name";

function App() {
  const [user, setUser] = useState(null);
  const [threads, setThreads] = useState([]);
  const [selectedThreadId, setSelectedThreadId] = useState("");
  const [messages, setMessages] = useState([]);
  const [device, setDevice] = useState(null);
  const [filter, setFilter] = useState("open");
  const [draft, setDraft] = useState("");
  const [loginForm, setLoginForm] = useState({
    name: localStorage.getItem(OPERATOR_NAME_STORAGE_KEY) || "",
    email: "",
    password: "",
  });
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isUpdatingThread, setIsUpdatingThread] = useState(false);
  const messagesEndRef = useRef(null);

  const operatorName = useMemo(() => {
    const trimmedName = loginForm.name.trim();
    if (trimmedName) {
      return trimmedName;
    }

    return localStorage.getItem(OPERATOR_NAME_STORAGE_KEY) || user?.email || "Destek";
  }, [loginForm.name, user]);

  useEffect(() => {
    setPersistence(auth, browserLocalPersistence).catch(() => {});

    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      if (nextUser && SUPPORT_ALLOWED_EMAILS.length > 0) {
        const normalizedEmail = (nextUser.email || "").trim().toLowerCase();
        if (!SUPPORT_ALLOWED_EMAILS.includes(normalizedEmail)) {
          await signOut(auth);
          setErrorMessage("Bu hesap destek paneli icin yetkili degil.");
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

    const unsubscribe = onSnapshot(
      query(collection(db, "supportThreads"), orderBy("updatedAt", "desc")),
      (snapshot) => {
        const nextThreads = snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }));

        setThreads(nextThreads);
      },
      (error) => {
        setErrorMessage(error.message);
      }
    );

    return unsubscribe;
  }, [user]);

  const filteredThreads = useMemo(() => {
    if (filter === "all") {
      return threads;
    }

    if (filter === "closed") {
      return threads.filter((thread) => thread.status === "closed");
    }

    return threads.filter((thread) => thread.status !== "closed");
  }, [filter, threads]);

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedThreadId) || null,
    [selectedThreadId, threads]
  );

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
    if (!selectedThreadId) {
      setMessages([]);
      return undefined;
    }

    const messagesQuery = query(
      collection(db, "supportThreads", selectedThreadId, "messages"),
      orderBy("createdAt", "asc")
    );

    const unsubscribeMessages = onSnapshot(
      messagesQuery,
      (snapshot) => {
        setMessages(
          snapshot.docs.map((item) => ({
            id: item.id,
            ...item.data(),
          }))
        );
      },
      (error) => setErrorMessage(error.message)
    );

    return () => {
      unsubscribeMessages();
    };
  }, [selectedThreadId]);

  useEffect(() => {
    if (!selectedThreadId || !selectedThread?.deviceId) {
      setDevice(null);
      return undefined;
    }

    getDoc(doc(db, "devices", selectedThread.deviceId))
        .then((snapshot) => {
          setDevice(snapshot.exists() ? snapshot.data() : null);
        })
        .catch((error) => setErrorMessage(error.message));

    updateDoc(doc(db, "supportThreads", selectedThreadId), {
      unreadBySupport: 0,
    }).catch(() => {});
  }, [selectedThreadId, selectedThread?.deviceId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  async function handleLogin(event) {
    event.preventDefault();

    const normalizedName = loginForm.name.trim();
    if (!normalizedName) {
      setErrorMessage("Operator adi girmeniz gerekiyor.");
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
        closedAt: nextStatus === "closed" ? serverTimestamp() : null,
        updatedAt: serverTimestamp(),
        assignedOperatorId: selectedThread.assignedOperatorId || user.uid,
        assignedOperatorName: selectedThread.assignedOperatorName || operatorName,
      });

      await addDoc(collection(db, "supportThreads", selectedThread.id, "events"), {
        type: nextStatus === "closed" ? "closed" : "reopened",
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
          unreadByUser: (selectedThread.unreadByUser || 0) + 1,
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

  if (!user) {
    return (
      <div className="login-shell">
        <form className="login-card" onSubmit={handleLogin}>
          <div className="eyebrow">SMSX Support Admin</div>
          <h1>Destek paneli</h1>
          <p>Operatörler burada kullanıcı mesajlarını görür, cevaplar ve sohbeti kapatır.</p>

          <label>
            <span>Operator adi</span>
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
              placeholder="support@receivesmsonline.co"
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

          {errorMessage ? <div className="error-box">{errorMessage}</div> : null}

          <button className="primary-button" type="submit" disabled={isLoggingIn}>
            {isLoggingIn ? "Giris yapiliyor..." : "Giris yap"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">Canli Destek</div>
          <h1>SMSX destek merkezi</h1>
        </div>

        <div className="topbar-actions">
          <div className="user-pill">
            <strong>{operatorName}</strong>
            <span>{user.email}</span>
          </div>
          <button className="ghost-button" type="button" onClick={handleLogout}>
            Cikis yap
          </button>
        </div>
      </header>

      {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}

      <div className="filter-row">
        {[
          { id: "open", label: "Acik" },
          { id: "closed", label: "Kapali" },
          { id: "all", label: "Tum" },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            className={`filter-chip${filter === item.id ? " active" : ""}`}
            onClick={() => setFilter(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <main className="panel-grid">
        <aside className="panel panel-list">
          <div className="panel-title-row">
            <h2>Sohbetler</h2>
            <span>{filteredThreads.length}</span>
          </div>

          <div className="thread-list">
            {filteredThreads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                className={`thread-card${thread.id === selectedThreadId ? " active" : ""}`}
                onClick={() => setSelectedThreadId(thread.id)}
              >
                <div className="thread-card-top">
                  <strong>{thread.subject || "Destek Konusu"}</strong>
                  <span className={`status-chip status-${thread.status || "waiting_support"}`}>
                    {STATUS_LABELS[thread.status] || "Acik"}
                  </span>
                </div>

                <p>{thread.lastMessageText || "Yeni sohbet"}</p>

                <div className="thread-card-bottom">
                  <span>{formatDate(thread.updatedAt || thread.createdAt)}</span>
                  {thread.unreadBySupport > 0 ? (
                    <span className="unread-dot">{thread.unreadBySupport}</span>
                  ) : null}
                </div>
              </button>
            ))}

            {!filteredThreads.length ? (
              <div className="empty-card">Gosterilecek sohbet bulunmuyor.</div>
            ) : null}
          </div>
        </aside>

        <section className="panel panel-conversation">
          {selectedThread ? (
            <>
              <div className="panel-title-row">
                <div>
                  <h2>{selectedThread.subject || "Destek Konusu"}</h2>
                  <span className="muted">
                    Device ID: {selectedThread.deviceId || "-"} · {STATUS_LABELS[selectedThread.status] || "Acik"}
                  </span>
                </div>

                <div className="conversation-actions">
                  <button className="ghost-button" type="button" onClick={assignToMe} disabled={isUpdatingThread}>
                    Ustlen
                  </button>

                  {selectedThread.status === "closed" ? (
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => updateThreadStatus("waiting_user")}
                      disabled={isUpdatingThread}
                    >
                      Tekrar ac
                    </button>
                  ) : (
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => updateThreadStatus("closed")}
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

                {!messages.length ? <div className="empty-card">Bu sohbette henuz mesaj yok.</div> : null}
              </div>

              <form className="composer" onSubmit={sendMessage}>
                <input
                  type="text"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Kullaniciya cevap yazin"
                  disabled={selectedThread.status === "closed"}
                />
                <button
                  className="primary-button"
                  type="submit"
                  disabled={isSending || selectedThread.status === "closed" || !draft.trim()}
                >
                  {isSending ? "Gonderiliyor..." : "Gonder"}
                </button>
              </form>
            </>
          ) : (
            <div className="empty-card stretch">Bir sohbet secin.</div>
          )}
        </section>

        <aside className="panel panel-sidebar">
          <div className="panel-title-row">
            <h2>Cihaz Ozeti</h2>
          </div>

          {selectedThread ? (
            <div className="summary-stack">
              <SummaryCard
                title="Sohbet"
                rows={[
                  ["Device ID", selectedThread.deviceId || "-"],
                  ["Durum", STATUS_LABELS[selectedThread.status] || "-"],
                  ["Operator", selectedThread.assignedOperatorName || "-"],
                  ["User unread", String(selectedThread.unreadByUser || 0)],
                  ["Support unread", String(selectedThread.unreadBySupport || 0)],
                ]}
              />

              <SummaryCard
                title="Snapshot"
                rows={[
                  ["Kredi", String(selectedThread.deviceSnapshot?.credits ?? "-")],
                  ["Abonelik", selectedThread.deviceSnapshot?.hasSubscription ? "Var" : "Yok"],
                  ["Mail", selectedThread.deviceSnapshot?.mail || "-"],
                  ["iOS", selectedThread.deviceSnapshot?.iosVersion || "-"],
                  ["App", selectedThread.deviceSnapshot?.appVersion || "-"],
                ]}
              />

              <SummaryCard
                title="Canli cihaz verisi"
                rows={[
                  ["Kredi", String(device?.credits ?? "-")],
                  ["Abonelik", device?.hasSubscription ? "Var" : "Yok"],
                  ["Mail", device?.mail || "-"],
                  ["Ban", device?.ban ? "Evet" : "Hayir"],
                  ["FCM", device?.fcmToken ? "Kayitli" : "Yok"],
                ]}
              />
            </div>
          ) : (
            <div className="empty-card">Bir sohbet sectiginizde cihaz bilgileri burada gorunur.</div>
          )}
        </aside>
      </main>
    </div>
  );
}

function SummaryCard({ title, rows }) {
  return (
    <section className="summary-card">
      <h3>{title}</h3>

      <div className="summary-rows">
        {rows.map(([label, value]) => (
          <div className="summary-row" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function formatDate(value, timeOnly = false) {
  const date = toDateValue(value);
  if (!date) return "-";

  return new Intl.DateTimeFormat("tr-TR", timeOnly
    ? { hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }
  ).format(date);
}

function toDateValue(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === "function") return value.toDate();
  return null;
}

export default App;
