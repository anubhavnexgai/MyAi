/**
 * MyAi Web UI — WebSocket chat client with authentication.
 * v2 — Markdown rendering (marked.js) + Syntax highlighting (Prism.js)
 */

(function () {
    "use strict";

    // -- Config --
    const DEFAULT_WS_URL = `ws://${location.host}/ws`;
    const RECONNECT_DELAY_MS = 3000;
    const MAX_RECONNECT_ATTEMPTS = 10;

    // -- Markdown setup --
    if (typeof marked !== "undefined") {
        // marked v12+ uses token-based renderer methods
        var renderer = {
            code: function (token) {
                var code = token.text || "";
                var lang = (token.lang || "").trim();
                var langLabel = lang || "code";
                var highlighted;
                if (typeof Prism !== "undefined" && lang && Prism.languages[lang]) {
                    try {
                        highlighted = Prism.highlight(code, Prism.languages[lang], lang);
                    } catch (e) {
                        highlighted = escapeHtmlStr(code);
                    }
                } else {
                    highlighted = escapeHtmlStr(code);
                }
                return '<pre><div class="code-header"><span>' + escapeHtmlStr(langLabel) + '</span><button class="copy-btn" onclick="window._copyCode(this)">Copy</button></div><code class="language-' + escapeHtmlStr(langLabel) + '">' + highlighted + '</code></pre>';
            },
            link: function (token) {
                var href = token.href || "";
                var title = token.title || "";
                // In marked v12, token.tokens contains the parsed inline content
                // token.text is the raw text form
                var text = token.text || "";
                var titleAttr = title ? ' title="' + escapeHtmlStr(title) + '"' : '';
                // Use this.parser.parseInline if available for rich link text
                var rendered = text;
                if (this && this.parser && token.tokens) {
                    try { rendered = this.parser.parseInline(token.tokens); } catch(e) { rendered = text; }
                }
                return '<a href="' + href + '" target="_blank" rel="noopener"' + titleAttr + '>' + rendered + '</a>';
            },
        };

        marked.use({
            breaks: true,
            gfm: true,
            renderer: renderer,
        });
    }

    // Inline escapeHtml for use before DOM is guaranteed
    function escapeHtmlStr(str) {
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    // Copy code button handler
    window._copyCode = function (btn) {
        var pre = btn.closest("pre");
        if (!pre) return;
        var code = pre.querySelector("code");
        if (!code) return;
        var text = code.textContent || code.innerText;
        navigator.clipboard.writeText(text).then(function () {
            btn.textContent = "Copied!";
            setTimeout(function () { btn.textContent = "Copy"; }, 2000);
        }).catch(function () {
            btn.textContent = "Failed";
            setTimeout(function () { btn.textContent = "Copy"; }, 2000);
        });
    };

    // -- State --
    let ws = null;
    let reconnectAttempts = 0;
    let reconnectTimer = null;
    let settings = loadSettings();
    let currentUser = null;
    let authToken = localStorage.getItem("myai_auth_token") || null;
    let activeConversationId = null;
    let conversationsList = [];

    // -- DOM refs --
    const $messages = document.getElementById("messages");
    const $form = document.getElementById("chat-form");
    const $input = document.getElementById("chat-input");
    const $sendBtn = document.getElementById("btn-send");
    const $typing = document.getElementById("typing-indicator");
    const $connDot = document.getElementById("conn-dot");
    const $connStatus = document.getElementById("connection-status");
    const $sidebar = document.getElementById("sidebar");
    const $toggleSidebar = document.getElementById("btn-toggle-sidebar");
    const $settingsModal = document.getElementById("settings-modal");
    const $closeSettings = document.getElementById("btn-close-settings");
    const $saveSettings = document.getElementById("btn-save-settings");
    const $settingUserId = document.getElementById("setting-user-id");
    const $settingUserName = document.getElementById("setting-user-name");
    const $settingWsUrl = document.getElementById("setting-ws-url");

    // Status panel refs
    const $statusOllama = document.getElementById("status-ollama");
    const $statusModel = document.getElementById("status-model");
    const $statusGraph = document.getElementById("status-graph");
    const $statusSearch = document.getElementById("status-search");
    const $searchToggle = document.getElementById("search-toggle");
    const $skillsList = document.getElementById("skills-list");

    // Header pill refs
    const $modelPillName = document.getElementById("model-pill-name");
    const $ms365Pill = document.getElementById("ms365-pill");
    const $ms365StatusText = document.getElementById("ms365-status-text");

    // Auth refs
    const $authScreen = document.getElementById("auth-screen");
    const $setupForm = document.getElementById("setup-form");
    const $loginForm = document.getElementById("login-form");
    const $authLoading = document.getElementById("auth-loading");
    const $chatArea = document.getElementById("chat-area");
    const $logoutBtn = document.getElementById("btn-logout");
    const $userDisplayName = document.getElementById("user-display-name");
    const $userRoleBadge = document.getElementById("user-role-badge");

    // New sidebar button refs
    const $btnNewChat = document.getElementById("btn-new-chat");
    const $btnSettings = document.getElementById("btn-settings");
    const $btnStatusToggle = document.getElementById("btn-status-toggle");
    const $statusPanel = document.getElementById("status-panel");
    const $recentChats = document.getElementById("recent-chats");

    // -- Init --
    function init() {
        bindAuthEvents();
        checkSetup();
        bindPersonaEvents();
        // Request notification permission early
        if ("Notification" in window && Notification.permission === "default") {
            Notification.requestPermission();
        }
    }

    function loadSettings() {
        try {
            const saved = JSON.parse(localStorage.getItem("myai_settings") || "{}");
            return {
                userId: saved.userId || "web-user-" + Math.random().toString(36).slice(2, 8),
                userName: saved.userName || "User",
                wsUrl: saved.wsUrl || "",
            };
        } catch {
            return { userId: "web-user-1", userName: "User", wsUrl: "" };
        }
    }

    function saveSettings() {
        localStorage.setItem("myai_settings", JSON.stringify(settings));
    }

    // -- Persona selection --
    function bindPersonaEvents() {
        var personaAvatars = document.querySelectorAll(".persona-avatar");
        personaAvatars.forEach(function (avatar) {
            avatar.addEventListener("click", function () {
                personaAvatars.forEach(function (a) { a.classList.remove("active"); });
                avatar.classList.add("active");
                var persona = avatar.getAttribute("data-persona");
                var typingLetter = document.querySelector(".typing-avatar-letter");
                if (typingLetter) {
                    typingLetter.textContent = persona.charAt(0).toUpperCase();
                }
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: "message",
                        text: "/persona " + persona,
                        user_id: settings.userId,
                        user_name: settings.userName,
                    }));
                }
            });
        });

        // Add Persona button + modal
        var $addBtn = document.getElementById("btn-add-persona");
        var $modal = document.getElementById("persona-modal");
        var $modalClose = document.getElementById("persona-modal-close");
        var $nameInput = document.getElementById("persona-name-input");
        var $descInput = document.getElementById("persona-desc-input");
        var $createBtn = document.getElementById("btn-create-persona");
        var $error = document.getElementById("persona-create-error");

        if ($addBtn && $modal) {
            $addBtn.addEventListener("click", function () {
                $modal.classList.remove("hidden");
                $nameInput.value = "";
                $descInput.value = "";
                $error.classList.add("hidden");
                setTimeout(function () { $nameInput.focus(); }, 100);
            });

            $modalClose.addEventListener("click", function () {
                $modal.classList.add("hidden");
            });

            $modal.addEventListener("click", function (e) {
                if (e.target === $modal) $modal.classList.add("hidden");
            });

            // Suggestion chips
            var suggestions = document.querySelectorAll(".persona-suggestion");
            suggestions.forEach(function (chip) {
                chip.addEventListener("click", function () {
                    suggestions.forEach(function (s) { s.classList.remove("selected"); });
                    chip.classList.add("selected");
                    $descInput.value = chip.getAttribute("data-desc");
                    if (!$nameInput.value) {
                        $nameInput.value = chip.textContent.trim().split(" ")[0];
                    }
                    $nameInput.focus();
                });
            });

            // Create persona
            $createBtn.addEventListener("click", function () {
                var name = $nameInput.value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
                var desc = $descInput.value.trim();

                if (!name || name.length < 2) {
                    $error.textContent = "Name must be at least 2 characters (letters, numbers, underscore).";
                    $error.classList.remove("hidden");
                    return;
                }
                if (!desc || desc.length < 10) {
                    $error.textContent = "Please provide a meaningful description (at least 10 characters).";
                    $error.classList.remove("hidden");
                    return;
                }

                $error.classList.add("hidden");
                $createBtn.disabled = true;
                $createBtn.textContent = "Creating...";

                // Send persona creation command via WebSocket
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: "message",
                        text: "/create-persona " + name + " " + desc,
                        user_id: settings.userId,
                        user_name: settings.userName,
                    }));
                }

                // Add avatar to UI immediately
                var displayName = $nameInput.value.trim();
                var initial = displayName.charAt(0).toUpperCase();
                var avatarHtml = '<button class="persona-avatar" data-persona="' + name + '" title="' + displayName + '">' +
                    '<div class="persona-avatar-ring"><span class="persona-initial">' + initial + '</span></div>' +
                    '<span class="persona-name">' + displayName + '</span>' +
                    '<span class="persona-status-dot online"></span></button>';

                var container = document.getElementById("persona-avatars");
                container.insertAdjacentHTML("beforeend", avatarHtml);

                // Re-bind click events for the new avatar
                var newAvatar = container.lastElementChild;
                newAvatar.addEventListener("click", function () {
                    document.querySelectorAll(".persona-avatar").forEach(function (a) { a.classList.remove("active"); });
                    newAvatar.classList.add("active");
                    var typLetter = document.querySelector(".typing-avatar-letter");
                    if (typLetter) typLetter.textContent = initial;
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            type: "message", text: "/persona " + name,
                            user_id: settings.userId, user_name: settings.userName,
                        }));
                    }
                });

                // Close modal
                setTimeout(function () {
                    $modal.classList.add("hidden");
                    $createBtn.disabled = false;
                    $createBtn.textContent = "Create Persona";
                }, 500);
            });
        }
    }

    // -- Auth Flow --
    async function checkSetup() {
        // Skip login — go directly to chat (personal agent, no auth needed)
        $authLoading.classList.add("hidden");
        currentUser = { id: "local-user", display_name: settings.userName, role_level: "super_admin" };
        showChat();
    }

    async function validateToken() {
        try {
            const res = await fetch("/api/auth/me", {
                headers: { "Authorization": "Bearer " + authToken },
            });
            if (!res.ok) return false;
            const data = await res.json();
            if (data.user) {
                currentUser = data.user;
                return true;
            }
            return false;
        } catch {
            return false;
        }
    }

    async function setupAdmin(e) {
        e.preventDefault();
        const email = document.getElementById("setup-email").value.trim();
        const displayName = document.getElementById("setup-name").value.trim();
        const password = document.getElementById("setup-password").value;
        const confirmPassword = document.getElementById("setup-confirm-password").value;
        const $error = document.getElementById("setup-error");

        $error.classList.add("hidden");

        if (!email || !displayName || !password) {
            showAuthError($error, "All fields are required.");
            return;
        }

        if (password.length < 6) {
            showAuthError($error, "Password must be at least 6 characters.");
            return;
        }

        if (password !== confirmPassword) {
            showAuthError($error, "Passwords do not match.");
            return;
        }

        try {
            const res = await fetch("/api/auth/setup", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, display_name: displayName, password }),
            });
            const data = await res.json();

            if (!res.ok) {
                showAuthError($error, data.error || "Setup failed.");
                return;
            }

            // Setup successful, store token
            authToken = data.token;
            currentUser = data.user;
            localStorage.setItem("myai_auth_token", authToken);
            if (data.user) localStorage.setItem("myai_user", JSON.stringify(data.user));
            showChat();
        } catch (err) {
            showAuthError($error, "Connection failed. Is MyAi running?");
        }
    }

    async function login(e) {
        e.preventDefault();
        const email = document.getElementById("login-email").value.trim();
        const password = document.getElementById("login-password").value;
        const $error = document.getElementById("login-error");

        $error.classList.add("hidden");

        if (!email || !password) {
            showAuthError($error, "Email and password are required.");
            return;
        }

        try {
            const res = await fetch("/api/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password }),
            });
            const data = await res.json();

            if (!res.ok) {
                showAuthError($error, data.error || "Login failed.");
                return;
            }

            authToken = data.token;
            currentUser = data.user;
            localStorage.setItem("myai_auth_token", authToken);
            if (data.user) localStorage.setItem("myai_user", JSON.stringify(data.user));
            showChat();
        } catch (err) {
            showAuthError($error, "Connection failed. Is MyAi running?");
        }
    }

    async function logout() {
        try {
            if (authToken) {
                await fetch("/api/auth/logout", {
                    method: "POST",
                    headers: { "Authorization": "Bearer " + authToken },
                });
            }
        } catch {
            // Ignore errors during logout
        }

        authToken = null;
        currentUser = null;
        activeConversationId = null;
        conversationsList = [];
        localStorage.removeItem("myai_auth_token");

        // Disconnect WebSocket
        disconnect();

        // Show auth screen
        $authScreen.classList.remove("hidden");
        $sidebar.classList.add("hidden");
        $chatArea.classList.add("hidden");
        $messages.innerHTML = "";

        // Reset reconnect
        reconnectAttempts = 0;

        // Re-check setup to show appropriate form
        $authLoading.classList.remove("hidden");
        $loginForm.classList.add("hidden");
        $setupForm.classList.add("hidden");
        checkSetup();
    }

    function showAuthError($el, message) {
        $el.textContent = message;
        $el.classList.remove("hidden");
    }

    function showChat() {
        // Hide auth screen, show chat
        $authScreen.classList.add("hidden");
        $sidebar.classList.remove("hidden");
        $chatArea.classList.remove("hidden");

        // Update user info in sidebar
        if (currentUser) {
            $userDisplayName.textContent = currentUser.display_name || "User";
            $userRoleBadge.textContent = formatRoleName(currentUser.role_level);
            $userRoleBadge.className = "user-role-badge role-" + currentUser.role_level;

            // Show admin links for admin+ roles
            var linkDashboard = document.getElementById("link-admin-dashboard");
            var linkLearning = document.getElementById("link-admin-learning");
            if (currentUser.role_level === "super_admin" || currentUser.role_level === "admin") {
                if (linkDashboard) linkDashboard.classList.remove("hidden");
                if (linkLearning) linkLearning.classList.remove("hidden");
            }
        }

        // Populate settings fields
        $settingUserId.value = settings.userId;
        $settingUserName.value = settings.userName;
        $settingWsUrl.value = settings.wsUrl || DEFAULT_WS_URL;

        connect();
        bindChatEvents();
        loadConversationsList();
        loadChatHistory();
        fetchStatus();
        fetchSkills();

        // Admin links — pass token via query param
        var linkDashboard = document.getElementById("link-admin-dashboard");
        var linkLearning = document.getElementById("link-admin-learning");
        if (linkDashboard) {
            linkDashboard.addEventListener("click", function(e) {
                e.preventDefault();
                window.location.href = "/admin?token=" + encodeURIComponent(authToken || "");
            });
        }
        if (linkLearning) {
            linkLearning.addEventListener("click", function(e) {
                e.preventDefault();
                window.location.href = "/admin/learning?token=" + encodeURIComponent(authToken || "");
            });
        }
    }

    function loadChatHistory(conversationId) {
        if (!authToken) {
            // No auth — show welcome on fresh start, skip history fetch
            if (!conversationId) {
                showWelcome();
            }
            return;
        }

        var url;
        if (conversationId) {
            url = "/api/conversations/" + encodeURIComponent(conversationId) + "/history?limit=50";
        } else {
            url = "/api/chat/history?limit=50";
        }

        fetch(url, {
            headers: { "Authorization": "Bearer " + authToken },
        })
            .then(function (r) {
                if (!r.ok) throw new Error("Failed to load history");
                return r.json();
            })
            .then(function (data) {
                var messages = data.messages || [];
                if (messages.length === 0) {
                    showWelcome();
                    return;
                }

                // Remove welcome if present, since we have history
                removeWelcome();

                for (var i = 0; i < messages.length; i++) {
                    var msg = messages[i];
                    addHistoryMessage(msg.role, msg.content, msg.id, msg.conversation_id, msg.timestamp);
                }
                scrollToBottom();
            })
            .catch(function () {
                // If history load fails, just show welcome
                showWelcome();
            });
    }

    function addHistoryMessage(role, text, messageId, conversationId, timestamp) {
        var $msg = document.createElement("div");
        $msg.className = "message " + role;

        if (messageId) {
            $msg.setAttribute("data-message-id", messageId);
            $msg.setAttribute("data-conversation-id", conversationId || "");
        }

        var html = "";
        html += renderMessageContent(role, text);

        // Format the stored timestamp
        var timeStr = "";
        if (timestamp) {
            try {
                var d = new Date(timestamp);
                timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            } catch (e) {
                timeStr = "";
            }
        }
        html += '<span class="msg-time">' + timeStr + '</span>';

        $msg.innerHTML = html;
        $messages.appendChild($msg);
    }

    function formatRoleName(role) {
        if (!role) return "User";
        return role.replace(/_/g, " ").replace(/\b\w/g, function (c) {
            return c.toUpperCase();
        });
    }

    // -- WebSocket --
    function connect() {
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
            return;
        }

        const url = settings.wsUrl || DEFAULT_WS_URL;
        setConnStatus("connecting", "Connecting...");

        try {
            ws = new WebSocket(url);
        } catch (e) {
            setConnStatus("disconnected", "Failed");
            scheduleReconnect();
            return;
        }

        ws.onopen = function () {
            reconnectAttempts = 0;
            setConnStatus("connected", "Connected");
            $sendBtn.disabled = false;

            // Send auth with token if available
            if (authToken) {
                ws.send(JSON.stringify({
                    type: "auth",
                    token: authToken,
                }));
            } else {
                // Legacy fallback
                ws.send(JSON.stringify({
                    type: "auth",
                    user_id: settings.userId,
                    user_name: settings.userName,
                }));
            }
        };

        ws.onmessage = function (event) {
            try {
                var data = JSON.parse(event.data);
                handleServerMessage(data);
            } catch (err) {
                // Plain text fallback
                addMessage("assistant", event.data);
            }
        };

        ws.onclose = function () {
            setConnStatus("disconnected", "Disconnected");
            $sendBtn.disabled = true;
            hideTyping();
            scheduleReconnect();
        };

        ws.onerror = function () {
            // onclose will fire after this
        };
    }

    function scheduleReconnect() {
        if (reconnectTimer) return;
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            addSystemMessage("Unable to connect. Check that MyAi is running on port 8001.");
            return;
        }
        reconnectAttempts++;
        reconnectTimer = setTimeout(function () {
            reconnectTimer = null;
            connect();
        }, RECONNECT_DELAY_MS);
    }

    function disconnect() {
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        reconnectAttempts = MAX_RECONNECT_ATTEMPTS; // prevent auto-reconnect
        if (ws) {
            ws.close();
            ws = null;
        }
    }

    // -- Message handling --
    function handleServerMessage(data) {
        switch (data.type) {
            case "response":
                hideTyping();
                var msgText = data.text;
                addMessage("assistant", msgText, data.agent, data.message_id, data.conversation_id, data.source, data.suggestions);
                // Track active conversation from server response
                if (data.conversation_id && !activeConversationId) {
                    activeConversationId = data.conversation_id;
                    // Tell server about the active conversation
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            type: "switch_conversation",
                            conversation_id: activeConversationId,
                        }));
                    }
                }
                // Refresh sidebar to show updated preview
                loadConversationsList();
                // Add Microsoft connect button after the message
                if (data.action === "connect_microsoft" && data.connect_url) {
                    var btnDiv = document.createElement("div");
                    btnDiv.style.cssText = "text-align:center;padding:12px 0;";
                    var btn = document.createElement("a");
                    btn.href = data.connect_url;
                    btn.target = "_blank";
                    btn.className = "connect-btn";
                    btn.textContent = "Sign in with Microsoft";
                    btnDiv.appendChild(btn);
                    $messages.appendChild(btnDiv);
                    scrollToBottom();
                }
                break;
            case "stream_end":
                hideTyping();
                addMessage("assistant", data.text, data.agent, data.message_id, data.conversation_id, data.source);
                if (data.conversation_id && !activeConversationId) {
                    activeConversationId = data.conversation_id;
                }
                loadConversationsList();
                break;
            case "feedback_ack":
                markFeedbackSent(data.message_id, data.rating);
                break;
            case "error":
                hideTyping();
                addErrorMessage(data.text || "An error occurred.");
                break;
            case "auth_error":
                hideTyping();
                addErrorMessage(data.text || "Authentication failed.");
                // Token is invalid, force re-login
                logout();
                break;
            case "status":
                updateStatusPanel(data);
                break;
            case "skills":
                renderSkills(data.skills || []);
                break;
            case "typing":
                showTyping(data.text);
                break;
            case "conversation_switched":
                // Server confirmed the conversation switch
                break;
            case "conversations_updated":
                // Refresh sidebar conversation list
                loadConversationsList();
                break;
            case "system":
                // Show reminders and file alerts as prominent notifications
                if (data.source === "reminder" || data.source === "file_watcher") {
                    addNotificationMessage(data.text, data.source);
                    showBrowserNotification(
                        data.source === "reminder" ? "MyAi Reminder" : "MyAi File Alert",
                        data.text.replace(/\*\*/g, "").substring(0, 100)
                    );
                    // Also play a sound
                    try { new Audio("data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbsGczIj2markup_fixed").play(); } catch(e) {}
                } else {
                    addSystemMessage(data.text);
                }
                // Update current user if provided
                if (data.user) {
                    currentUser = data.user;
                    $userDisplayName.textContent = currentUser.display_name || "User";
                    $userRoleBadge.textContent = formatRoleName(currentUser.role_level);
                    $userRoleBadge.className = "user-role-badge role-" + currentUser.role_level;
                }
                break;
            default:
                if (data.text) {
                    hideTyping();
                    addMessage("assistant", data.text, data.agent);
                }
        }
    }

    // ----- Attachment state -------------------------------------------------
    // Files the user has picked / dragged but not yet sent. Each entry:
    //   {file: File, status: "pending"|"uploading"|"uploaded"|"error",
    //    path?, name, kind?, size, error?}
    var pendingAttachments = [];

    function attachmentKindOf(file) {
        var t = (file.type || "").toLowerCase();
        if (t.indexOf("image/") === 0) return "image";
        if (t === "application/pdf") return "pdf";
        if (t.indexOf("text/") === 0 || t === "application/json") return "text";
        if (t === "text/csv" || (file.name || "").toLowerCase().endsWith(".csv")) return "csv";
        return "binary";
    }

    function renderAttachmentChips() {
        var $area = document.getElementById("attachment-chips");
        if (!$area) return;
        if (pendingAttachments.length === 0) {
            $area.classList.add("hidden");
            $area.innerHTML = "";
            return;
        }
        $area.classList.remove("hidden");
        $area.innerHTML = "";
        pendingAttachments.forEach(function (att, idx) {
            var $chip = document.createElement("div");
            $chip.className = "attachment-chip status-" + att.status;
            var icon = "description";
            if (att.kind === "image") icon = "image";
            else if (att.kind === "pdf") icon = "picture_as_pdf";
            else if (att.kind === "csv") icon = "table_chart";
            var sizeKb = Math.max(1, Math.round((att.size || 0) / 1024));
            $chip.innerHTML =
                '<span class="material-symbols-outlined chip-icon">' + icon + '</span>' +
                '<span class="chip-name" title="' + (att.name || "") + '">' +
                    (att.name || "file") + '</span>' +
                '<span class="chip-meta">' + sizeKb + ' KB</span>' +
                '<button type="button" class="chip-remove" title="Remove" data-idx="' + idx + '">' +
                    '<span class="material-symbols-outlined">close</span></button>';
            $chip.querySelector(".chip-remove").onclick = function (e) {
                e.preventDefault();
                pendingAttachments.splice(idx, 1);
                renderAttachmentChips();
                updateSendDisabled();
            };
            $area.appendChild($chip);
        });
    }

    function updateSendDisabled() {
        var $send = document.getElementById("btn-send");
        if (!$send) return;
        var hasText = $input.value.trim().length > 0;
        var hasAtt = pendingAttachments.some(function (a) {
            return a.status === "uploaded" || a.status === "pending" || a.status === "uploading";
        });
        $send.disabled = !(hasText || hasAtt);
    }

    function addLocalAttachments(fileList) {
        var files = Array.from(fileList || []);
        files.forEach(function (file) {
            // Reject anything > 25 MB before even uploading
            if (file.size > 25 * 1024 * 1024) {
                pendingAttachments.push({
                    file: file, name: file.name, size: file.size,
                    kind: attachmentKindOf(file),
                    status: "error", error: "exceeds 25 MB",
                });
                return;
            }
            pendingAttachments.push({
                file: file, name: file.name, size: file.size,
                kind: attachmentKindOf(file),
                status: "pending",
            });
        });
        renderAttachmentChips();
        updateSendDisabled();
        // Begin uploads immediately
        uploadPendingAttachments();
    }

    function uploadPendingAttachments() {
        pendingAttachments.forEach(function (att) {
            if (att.status !== "pending") return;
            att.status = "uploading";
            renderAttachmentChips();
            var fd = new FormData();
            fd.append("file", att.file, att.name);
            fetch("/api/upload", { method: "POST", body: fd })
                .then(function (r) { return r.json(); })
                .then(function (json) {
                    if (json.attachments && json.attachments.length) {
                        var rec = json.attachments[0];
                        att.status = "uploaded";
                        att.path = rec.path;
                        att.kind = rec.kind || att.kind;
                    } else {
                        att.status = "error";
                        att.error = (json && json.error) || "upload failed";
                    }
                    renderAttachmentChips();
                    updateSendDisabled();
                })
                .catch(function (err) {
                    att.status = "error";
                    att.error = String(err);
                    renderAttachmentChips();
                    updateSendDisabled();
                });
        });
    }

    // ----- Send (with attachments) ------------------------------------------
    function sendMessage(text) {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        // Allow sending with empty text if at least one uploaded attachment exists
        var ready = pendingAttachments.filter(function (a) { return a.status === "uploaded"; });
        if (!text.trim() && ready.length === 0) return;

        var displayText = text || "(no message)";
        if (ready.length > 0) {
            var names = ready.map(function (a) { return a.name; }).join(", ");
            displayText = (text ? text + "\n\n" : "") + "📎 " + names;
        }
        addMessage("user", displayText);
        showTyping();

        var attachmentsForServer = ready.map(function (a) {
            return { path: a.path, name: a.name, kind: a.kind };
        });

        ws.send(JSON.stringify({
            type: "message",
            text: text,
            attachments: attachmentsForServer,
            user_id: settings.userId,
            user_name: settings.userName,
        }));

        // Clear attachments after send
        pendingAttachments = [];
        renderAttachmentChips();
        updateSendDisabled();
    }

    function doSend() {
        var text = $input.value.trim();
        var hasAtt = pendingAttachments.some(function (a) { return a.status === "uploaded"; });
        if (!text && !hasAtt) return;
        removeWelcome();
        sendMessage(text);
        $input.value = "";
        autoResize();
    }

    // ----- Wire up paperclip + drag/drop after DOM is ready ----------------
    // ----- Pause / resume button -------------------------------------------
    (function setupPauseUI() {
        var $btn = document.getElementById("btn-pause");
        if (!$btn) return;
        var $icon = $btn.querySelector(".pause-icon");
        var $label = $btn.querySelector(".pause-label");

        function applyState(paused) {
            if (paused) {
                $btn.classList.add("is-paused");
                $btn.title = "Resume MyAi";
                if ($icon) $icon.textContent = "play_arrow";
                if ($label) $label.textContent = "Resume";
            } else {
                $btn.classList.remove("is-paused");
                $btn.title = "Pause MyAi (frees the GPU)";
                if ($icon) $icon.textContent = "pause";
                if ($label) $label.textContent = "Pause";
            }
        }

        // Hydrate from server on load
        fetch("/api/pause/state")
            .then(function (r) { return r.json(); })
            .then(function (s) { applyState(!!(s && s.paused)); })
            .catch(function () {});

        $btn.addEventListener("click", function () {
            var paused = $btn.classList.contains("is-paused");
            var url = paused ? "/api/resume" : "/api/pause";
            $btn.disabled = true;
            fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
                         body: JSON.stringify({}) })
                .then(function (r) { return r.json(); })
                .then(function (s) { applyState(!!(s && s.paused)); })
                .catch(function (e) { console.warn("pause toggle failed:", e); })
                .finally(function () { $btn.disabled = false; });
        });
    })();

    (function setupAttachUI() {
        var $btn = document.getElementById("btn-attach");
        var $fileInput = document.getElementById("file-input");
        if ($btn && $fileInput) {
            $btn.addEventListener("click", function () { $fileInput.click(); });
            $fileInput.addEventListener("change", function () {
                if ($fileInput.files && $fileInput.files.length) {
                    addLocalAttachments($fileInput.files);
                    $fileInput.value = "";  // allow re-pick same file
                }
            });
        }

        // Drag-and-drop on the whole document
        var $overlay = document.getElementById("drop-overlay");
        var dragDepth = 0;

        function isFileDrag(e) {
            if (!e.dataTransfer) return false;
            var t = e.dataTransfer.types;
            if (!t) return false;
            for (var i = 0; i < t.length; i++) {
                if (t[i] === "Files" || t[i] === "application/x-moz-file") return true;
            }
            return false;
        }

        document.addEventListener("dragenter", function (e) {
            if (!isFileDrag(e)) return;
            e.preventDefault();
            dragDepth++;
            if ($overlay) $overlay.classList.remove("hidden");
        });
        document.addEventListener("dragover", function (e) {
            if (!isFileDrag(e)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
        });
        document.addEventListener("dragleave", function (e) {
            if (!isFileDrag(e)) return;
            dragDepth = Math.max(0, dragDepth - 1);
            if (dragDepth === 0 && $overlay) $overlay.classList.add("hidden");
        });
        document.addEventListener("drop", function (e) {
            if (!isFileDrag(e)) return;
            e.preventDefault();
            dragDepth = 0;
            if ($overlay) $overlay.classList.add("hidden");
            var files = (e.dataTransfer && e.dataTransfer.files) || [];
            if (files.length) addLocalAttachments(files);
        });

        // Re-enable Send when text changes (with attachments present)
        if ($input) $input.addEventListener("input", updateSendDisabled);
    })();

    // -- UI rendering --
    function addMessage(role, text, agent, messageId, conversationId, source, serverSuggestions) {
        var $msg = document.createElement("div");
        $msg.className = "message " + role;

        if (messageId) {
            $msg.setAttribute("data-message-id", messageId);
            $msg.setAttribute("data-conversation-id", conversationId || "");
            $msg.setAttribute("data-source", source || "local");
            $msg.setAttribute("data-agent-name", agent || "");
        }

        var html = "";
        if (agent && role === "assistant") {
            html += '<span class="agent-tag">' + escapeHtml(agent) + '</span>';
        }
        html += renderMessageContent(role, text);
        html += '<span class="msg-time">' + formatTime() + '</span>';

        // Add feedback buttons for assistant messages
        if (role === "assistant" && messageId) {
            html += '<div class="feedback-buttons" data-msg-id="' + messageId + '">';
            html += '<button class="feedback-btn feedback-up" title="Good response" onclick="window._sendFeedback(' + messageId + ', \'up\', this)">&#x1F44D;</button>';
            html += '<button class="feedback-btn feedback-down" title="Poor response" onclick="window._sendFeedback(' + messageId + ', \'down\', this)">&#x1F44E;</button>';
            html += '</div>';
        }

        $msg.innerHTML = html;
        $messages.appendChild($msg);

        // Add suggestion chips after assistant messages (prefer server suggestions)
        if (role === "assistant" && text) {
            var suggestions = (serverSuggestions && serverSuggestions.length) ? serverSuggestions : getSuggestions(text);
            if (suggestions && suggestions.length) {
                var $chips = document.createElement("div");
                $chips.className = "suggestion-chips";
                for (var si = 0; si < suggestions.length; si++) {
                    var $chip = document.createElement("button");
                    $chip.className = "suggestion-chip";
                    $chip.textContent = suggestions[si];
                    $chip.setAttribute("data-suggestion", suggestions[si]);
                    $chip.onclick = (function (txt) {
                        return function () { window._sendSuggestion(txt); };
                    })(suggestions[si]);
                    $chips.appendChild($chip);
                }
                $messages.appendChild($chips);
            }
        }

        scrollToBottom();
    }

    // Feedback handler (exposed globally for onclick)
    window._sendFeedback = function (messageId, rating, btnEl) {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        var $msg = btnEl.closest(".message");
        var convId = $msg ? $msg.getAttribute("data-conversation-id") : "";
        var source = $msg ? $msg.getAttribute("data-source") : "local";
        var agentName = $msg ? $msg.getAttribute("data-agent-name") : null;

        ws.send(JSON.stringify({
            type: "feedback",
            message_id: messageId,
            conversation_id: convId,
            rating: rating,
            source: source,
            agent_name: agentName || undefined,
        }));

        // Disable both buttons and highlight the selected one
        var $container = btnEl.parentElement;
        var buttons = $container.querySelectorAll(".feedback-btn");
        for (var i = 0; i < buttons.length; i++) {
            buttons[i].disabled = true;
            buttons[i].classList.add("feedback-sent");
        }
        btnEl.classList.add("feedback-selected");
    };

    // Suggestion handler (exposed globally for onclick)
    window._sendSuggestion = function (text) {
        if (!text) return;
        removeWelcome();
        $input.value = text;
        doSend();
    };

    // Pre-fill "search the web for " and focus input
    window._prefillSearch = function () {
        $input.value = "search the web for ";
        $input.focus();
        // Place cursor at end
        var len = $input.value.length;
        $input.setSelectionRange(len, len);
    };

    // Return 2-3 contextual suggestion strings based on assistant response
    function getSuggestions(responseText) {
        if (!responseText) return ["Draft an email", "Help me plan my day"];
        var t = responseText.toLowerCase();

        if (/\b(file|folder|directory|download|document)\b/.test(t)) {
            return ["Summarize this document", "Email it to my team"];
        }
        if (/\b(code|python|javascript|function|class|def |import |bug)\b/.test(t)) {
            return ["Explain this code", "Write unit tests for it", "Refactor it"];
        }
        if (/\b(git|branch|commit|merge|pull request|push)\b/.test(t)) {
            return ["Draft a PR description", "Summarize changes for standup"];
        }
        if (/\b(email|sent|draft|outlook|mail)\b/.test(t)) {
            return ["Draft another email", "Remind me to follow up in 1 hour"];
        }
        if (/\b(search|results|article|news|trend)\b/.test(t)) {
            return ["Summarize the key takeaways", "Draft a Slack message about this"];
        }
        if (/\b(reminder|remind|alarm|set for)\b/.test(t)) {
            return ["What else do I need to do today?", "Set another reminder"];
        }
        if (/\b(cpu|ram|memory|disk|system|battery|usage)\b/.test(t)) {
            return ["Which apps are using the most resources?", "Free up some memory"];
        }
        if (/\b(meeting|agenda|standup|sprint|review)\b/.test(t)) {
            return ["Draft meeting notes", "Send a follow-up email"];
        }
        if (/\b(hello|hi|hey|good morning|good afternoon|how can i)\b/.test(t)) {
            return ["Plan my day", "Catch me up on what I missed", "Draft a status update"];
        }
        return ["Help me draft something", "What should I focus on today?"];
    }

    function markFeedbackSent(messageId, rating) {
        var $msg = document.querySelector('.message[data-message-id="' + messageId + '"]');
        if (!$msg) return;
        var $container = $msg.querySelector(".feedback-buttons");
        if (!$container) return;
        var buttons = $container.querySelectorAll(".feedback-btn");
        for (var i = 0; i < buttons.length; i++) {
            buttons[i].disabled = true;
            buttons[i].classList.add("feedback-sent");
        }
        var selected = rating === "up" ? ".feedback-up" : ".feedback-down";
        var $btn = $container.querySelector(selected);
        if ($btn) $btn.classList.add("feedback-selected");
    }

    function addSystemMessage(text) {
        var $msg = document.createElement("div");
        $msg.className = "message system";
        $msg.textContent = text;
        $messages.appendChild($msg);
        scrollToBottom();
    }

    function addNotificationMessage(text, source) {
        var $notif = document.createElement("div");
        $notif.className = "notification-banner " + (source || "");
        var icon = source === "reminder" ? "alarm" : "folder_open";
        var title = source === "reminder" ? "Reminder" : "New File Detected";
        var cleanText = text.replace(/\*\*/g, "").replace(/^Reminder:\s*/i, "");
        $notif.innerHTML =
            '<div class="notif-header">' +
            '<span class="material-symbols-outlined notif-icon">' + icon + '</span>' +
            '<span class="notif-title">' + title + '</span>' +
            '</div>' +
            '<div class="notif-body">' + escapeHtml(cleanText) + '</div>';
        $messages.appendChild($notif);
        scrollToBottom();
    }

    function addErrorMessage(text) {
        var $msg = document.createElement("div");
        $msg.className = "message error";
        $msg.textContent = text;
        $messages.appendChild($msg);
        scrollToBottom();
    }

    function getGreetingTime() {
        var h = new Date().getHours();
        if (h < 12) return "morning";
        if (h < 17) return "afternoon";
        return "evening";
    }

    function showWelcome() {
        var $welcome = document.createElement("div");
        $welcome.className = "welcome";
        $welcome.id = "welcome";
        var userName = (currentUser && currentUser.display_name) ? currentUser.display_name : "there";
        var greeting = getGreetingTime();
        $welcome.innerHTML =
            '<h2>Good ' + greeting + ', <span class="accent-word">' + escapeHtml(userName) + '</span></h2>' +
            '<p>Your personal AI assistant. What would you like to get done?</p>' +
            '<div class="welcome-actions">' +
                '<button class="welcome-action-card" onclick="window._sendSuggestion(\'draft a professional email to my manager with a quick status update on what I worked on this week\')">' +
                    '<span class="material-symbols-outlined">mail</span>' +
                    '<span class="welcome-action-label">Draft a status update email</span>' +
                '</button>' +
                '<button class="welcome-action-card" onclick="window._sendSuggestion(\'summarize the key points I need to prepare for my next meeting\')">' +
                    '<span class="material-symbols-outlined">event_note</span>' +
                    '<span class="welcome-action-label">Prep for my next meeting</span>' +
                '</button>' +
                '<button class="welcome-action-card" onclick="window._sendSuggestion(\'search the web for the latest trends in AI agents and enterprise copilots\')">' +
                    '<span class="material-symbols-outlined">trending_up</span>' +
                    '<span class="welcome-action-label">Latest AI industry trends</span>' +
                '</button>' +
                '<button class="welcome-action-card" onclick="window._sendSuggestion(\'help me write a clear and concise PRD outline for a new feature\')">' +
                    '<span class="material-symbols-outlined">description</span>' +
                    '<span class="welcome-action-label">Write a PRD outline</span>' +
                '</button>' +
                '<button class="welcome-action-card" onclick="window._sendSuggestion(\'remind me in 30 minutes to follow up on the pending code review\')">' +
                    '<span class="material-symbols-outlined">alarm</span>' +
                    '<span class="welcome-action-label">Set a work reminder</span>' +
                '</button>' +
                '<button class="welcome-action-card" onclick="window._sendSuggestion(\'list the files I downloaded recently and tell me which ones look important\')">' +
                    '<span class="material-symbols-outlined">folder_open</span>' +
                    '<span class="welcome-action-label">Review recent downloads</span>' +
                '</button>' +
            '</div>';
        $messages.appendChild($welcome);
    }

    function removeWelcome() {
        var $welcome = document.getElementById("welcome");
        if ($welcome) $welcome.remove();
    }

    function showTyping(text) {
        var $typingText = $typing.querySelector(".typing-text");
        $typingText.textContent = text || "MyAi is thinking...";
        $typing.classList.remove("hidden");
        scrollToBottom();
    }

    function hideTyping() {
        $typing.classList.add("hidden");
    }

    function scrollToBottom() {
        requestAnimationFrame(function () {
            $messages.scrollTo({
                top: $messages.scrollHeight,
                behavior: "smooth"
            });
        });
    }

    function setConnStatus(state, text) {
        // Update dot
        $connDot.className = "conn-dot " + state;
        // Update label
        $connStatus.className = "conn-label " + state;
        $connStatus.textContent = text;
    }

    // -- Conversations management --

    function loadConversationsList() {
        if (!authToken) return;

        fetch("/api/conversations", {
            headers: { "Authorization": "Bearer " + authToken },
        })
            .then(function (r) {
                if (!r.ok) throw new Error("Failed to load conversations");
                return r.json();
            })
            .then(function (data) {
                conversationsList = data.conversations || [];
                renderConversationsSidebar();
            })
            .catch(function () {
                // Silently fail
            });
    }

    function renderConversationsSidebar() {
        if (!$recentChats) return;
        $recentChats.innerHTML = "";

        if (conversationsList.length === 0) {
            var emptyMsg = document.createElement("div");
            emptyMsg.className = "recent-chat-empty";
            emptyMsg.textContent = "No conversations yet";
            $recentChats.appendChild(emptyMsg);
            return;
        }

        for (var i = 0; i < conversationsList.length; i++) {
            var conv = conversationsList[i];
            var $item = document.createElement("div");
            $item.className = "recent-chat-item";
            if (conv.id === activeConversationId) {
                $item.classList.add("active");
            }
            $item.setAttribute("data-conv-id", conv.id);

            var $title = document.createElement("span");
            $title.className = "recent-chat-title";
            $title.textContent = conv.title || "New Chat";
            $title.title = conv.title || "New Chat";

            var $actions = document.createElement("div");
            $actions.className = "recent-chat-actions";

            var $renameBtn = document.createElement("button");
            $renameBtn.className = "recent-chat-action-btn";
            $renameBtn.title = "Rename";
            $renameBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px">edit</span>';
            $renameBtn.setAttribute("data-conv-id", conv.id);
            $renameBtn.addEventListener("click", (function (convId, convTitle) {
                return function (e) {
                    e.stopPropagation();
                    promptRenameConversation(convId, convTitle);
                };
            })(conv.id, conv.title));

            var $deleteBtn = document.createElement("button");
            $deleteBtn.className = "recent-chat-action-btn";
            $deleteBtn.title = "Delete";
            $deleteBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px">delete</span>';
            $deleteBtn.setAttribute("data-conv-id", conv.id);
            $deleteBtn.addEventListener("click", (function (convId) {
                return function (e) {
                    e.stopPropagation();
                    deleteConversation(convId);
                };
            })(conv.id));

            $actions.appendChild($renameBtn);
            $actions.appendChild($deleteBtn);

            $item.appendChild($title);
            $item.appendChild($actions);

            $item.addEventListener("click", (function (convId) {
                return function () {
                    switchToConversation(convId);
                };
            })(conv.id));

            $recentChats.appendChild($item);
        }
    }

    function switchToConversation(convId) {
        if (convId === activeConversationId) return;

        activeConversationId = convId;

        // Tell the server to switch
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: "switch_conversation",
                conversation_id: convId,
            }));
        }

        // Clear and reload messages for this conversation
        $messages.innerHTML = "";
        loadChatHistory(convId);

        // Update sidebar highlight
        renderConversationsSidebar();
    }

    function createNewConversation() {
        if (!authToken) return;

        fetch("/api/conversations", {
            method: "POST",
            headers: {
                "Authorization": "Bearer " + authToken,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({}),
        })
            .then(function (r) {
                if (!r.ok) throw new Error("Failed to create conversation");
                return r.json();
            })
            .then(function (data) {
                var newConvId = data.conversation_id;
                activeConversationId = newConvId;

                // Tell server to switch
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: "switch_conversation",
                        conversation_id: newConvId,
                    }));
                }

                // Clear messages and show welcome
                $messages.innerHTML = "";
                showWelcome();

                // Reload sidebar
                loadConversationsList();
            })
            .catch(function (err) {
                addSystemMessage("Failed to create new conversation.");
            });
    }

    function deleteConversation(convId) {
        if (!confirm("Delete this conversation? This cannot be undone.")) return;
        if (!authToken) return;

        fetch("/api/conversations/" + encodeURIComponent(convId), {
            method: "DELETE",
            headers: { "Authorization": "Bearer " + authToken },
        })
            .then(function (r) {
                if (!r.ok) throw new Error("Failed to delete");
                return r.json();
            })
            .then(function () {
                // If we deleted the active conversation, switch to a new one
                if (convId === activeConversationId) {
                    activeConversationId = null;
                    $messages.innerHTML = "";
                    showWelcome();

                    // Tell server to reset
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            type: "switch_conversation",
                            conversation_id: null,
                        }));
                    }
                }
                loadConversationsList();
            })
            .catch(function () {
                addSystemMessage("Failed to delete conversation.");
            });
    }

    function promptRenameConversation(convId, currentTitle) {
        var newTitle = prompt("Rename conversation:", currentTitle || "");
        if (newTitle === null || newTitle.trim() === "") return;

        fetch("/api/conversations/" + encodeURIComponent(convId) + "/rename", {
            method: "POST",
            headers: {
                "Authorization": "Bearer " + authToken,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ title: newTitle.trim() }),
        })
            .then(function (r) {
                if (!r.ok) throw new Error("Failed to rename");
                return r.json();
            })
            .then(function () {
                loadConversationsList();
            })
            .catch(function () {
                addSystemMessage("Failed to rename conversation.");
            });
    }

    function clearChat() {
        $messages.innerHTML = "";
        showWelcome();

        // Also tell the server to clear conversation
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: "message",
                text: "/clear",
                user_id: settings.userId,
                user_name: settings.userName,
            }));
        }
    }

    // -- Web Search Toggle --
    function toggleSearch() {
        var isOn = $searchToggle.checked;
        var cmd = isOn ? "/search on" : "/search off";

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: "message",
                text: cmd,
                user_id: settings.userId,
                user_name: settings.userName,
            }));
        }

        $statusSearch.textContent = isOn ? "On" : "Off";
    }

    // -- Status & Skills --
    function fetchStatus() {
        fetch("/api/web/status")
            .then(function (r) { return r.json(); })
            .then(function (data) { updateStatusPanel(data); })
            .catch(function () {});
    }

    function fetchSkills() {
        fetch("/api/web/skills")
            .then(function (r) { return r.json(); })
            .then(function (data) { renderSkills(data.skills || []); })
            .catch(function () {});
    }

    function updateStatusPanel(data) {
        if (data.ollama !== undefined) {
            $statusOllama.textContent = data.ollama ? "Connected" : "Offline";
            $statusOllama.className = "status-badge " + (data.ollama ? "online" : "offline");
        }
        if (data.model) {
            $statusModel.textContent = data.model;
            // Also update the header model pill
            if ($modelPillName) {
                $modelPillName.textContent = data.model;
            }
        }
        if (data.graph !== undefined) {
            var graphText = data.graph === true ? "Connected" :
                            data.graph === "configured" ? "Not signed in" : "Not configured";
            var graphClass = data.graph === true ? "online" :
                             data.graph === "configured" ? "partial" : "offline";
            $statusGraph.textContent = graphText;
            $statusGraph.className = "status-badge " + graphClass;

            // Update MS365 pill in header
            if ($ms365Pill) {
                $ms365Pill.className = "ms365-pill " + graphClass;
                if (data.graph === true) {
                    $ms365StatusText.textContent = "M365";
                } else if (data.graph === "configured") {
                    $ms365StatusText.textContent = "M365";
                } else {
                    $ms365StatusText.textContent = "M365";
                }
            }
        }
        if (data.search !== undefined) {
            $statusSearch.textContent = data.search ? "On" : "Off";
            if ($searchToggle) {
                $searchToggle.checked = !!data.search;
            }
        }
    }

    function renderSkills(skills) {
        $skillsList.innerHTML = "";
        if (!skills.length) {
            $skillsList.innerHTML = '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:8px">No skills loaded</div>';
            return;
        }
        for (var i = 0; i < skills.length; i++) {
            var s = skills[i];
            var $item = document.createElement("div");
            $item.className = "skill-item";
            $item.innerHTML = '<span class="skill-name">' + escapeHtml(s.agent) + '</span><span class="skill-desc"> -- ' + escapeHtml(s.description) + '</span>';
            $skillsList.appendChild($item);
        }
    }

    // -- Formatting --
    function renderMessageContent(role, text) {
        if (role === "assistant" && typeof marked !== "undefined") {
            // Use marked.js for assistant messages
            try {
                var rendered = marked.parse(text);
                return '<div class="msg-content">' + rendered + '</div>';
            } catch (e) {
                // Fallback to basic formatting
                return '<div class="msg-content">' + formatMessageLegacy(text) + '</div>';
            }
        } else if (role === "user") {
            // User messages: simple text with line breaks
            return '<div class="msg-content">' + escapeHtml(text).replace(/\n/g, '<br>') + '</div>';
        } else {
            // System or other roles
            return formatMessageLegacy(text);
        }
    }

    function formatMessageLegacy(text) {
        // Preserve raw HTML elements (like connect buttons) before escaping
        var rawHtmlParts = [];
        var preserved = text.replace(/<a\s[^>]*>.*?<\/a>/gi, function (match) {
            var idx = rawHtmlParts.length;
            rawHtmlParts.push(match);
            return "%%HTML" + idx + "%%";
        });

        // Basic markdown-like formatting
        var html = escapeHtml(preserved);

        // Code blocks (```...```)
        html = html.replace(/```(\w*)\n([\s\S]*?)```/g, function (_, lang, code) {
            return '<pre><code>' + code.trim() + '</code></pre>';
        });

        // Inline code (`...`)
        html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

        // Bold (**...**)
        html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

        // Bold (*...* -- Slack style)
        html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<strong>$1</strong>");

        // Italic (_..._)
        html = html.replace(/(?<!_)_([^_]+)_(?!_)/g, "<em>$1</em>");

        // Links (<url|text> Slack style)
        html = html.replace(/&lt;(https?:\/\/[^|&]+)\|([^&]+)&gt;/g,
            '<a href="$1" target="_blank" rel="noopener">$2</a>');

        // Markdown links [text](url)
        html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
            '<a href="$2" target="_blank" rel="noopener">$1</a>');

        // Plain URLs (only those not already in an href)
        html = html.replace(/(?<!href="|">)(https?:\/\/[^\s<]+)/g,
            '<a href="$1" target="_blank" rel="noopener">$1</a>');

        // Restore preserved HTML elements
        for (var i = 0; i < rawHtmlParts.length; i++) {
            html = html.replace("%%HTML" + i + "%%", rawHtmlParts[i]);
        }

        return html;
    }

    function escapeHtml(text) {
        var div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }

    function showBrowserNotification(title, body) {
        if (!("Notification" in window)) return;
        if (Notification.permission === "granted") {
            new Notification(title, { body: body, icon: "/static/favicon.ico" });
        } else if (Notification.permission !== "denied") {
            Notification.requestPermission().then(function (perm) {
                if (perm === "granted") {
                    new Notification(title, { body: body });
                }
            });
        }
    }

    function formatTime() {
        return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }

    // -- Events --
    function bindAuthEvents() {
        $setupForm.addEventListener("submit", setupAdmin);
        $loginForm.addEventListener("submit", login);
        if ($logoutBtn) {
            $logoutBtn.addEventListener("click", logout);
        }
    }

    function bindChatEvents() {
        // Prevent default form submission entirely
        $form.addEventListener("submit", function (e) {
            e.preventDefault();
            e.stopPropagation();
            return false;
        });

        // Send button click
        $sendBtn.addEventListener("click", function (e) {
            e.preventDefault();
            doSend();
        });

        // Enter key sends, Shift+Enter adds new line
        $input.addEventListener("keydown", function (e) {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.stopPropagation();
                doSend();
            }
        });

        $input.addEventListener("input", autoResize);

        $toggleSidebar.addEventListener("click", function () {
            $sidebar.classList.toggle("collapsed");
        });

        // New Chat button creates a new conversation
        if ($btnNewChat) {
            $btnNewChat.addEventListener("click", createNewConversation);
        }

        // Settings button opens modal
        if ($btnSettings) {
            $btnSettings.addEventListener("click", function () {
                $settingsModal.classList.remove("hidden");
            });
        }

        // Status toggle
        if ($btnStatusToggle) {
            $btnStatusToggle.addEventListener("click", function () {
                $statusPanel.classList.toggle("hidden");
            });
        }

        // Web search toggle
        if ($searchToggle) {
            $searchToggle.addEventListener("change", toggleSearch);
        }

        $closeSettings.addEventListener("click", function () {
            $settingsModal.classList.add("hidden");
        });

        $settingsModal.addEventListener("click", function (e) {
            if (e.target === $settingsModal) {
                $settingsModal.classList.add("hidden");
            }
        });

        $saveSettings.addEventListener("click", function () {
            settings.userId = $settingUserId.value.trim() || settings.userId;
            settings.userName = $settingUserName.value.trim() || settings.userName;
            settings.wsUrl = $settingWsUrl.value.trim();
            saveSettings();
            $settingsModal.classList.add("hidden");
            addSystemMessage("Settings saved. Reconnecting...");
            disconnect();
            reconnectAttempts = 0;
            setTimeout(connect, 500);
        });

        // ── Connectors modal ──
        var $connBtn = document.getElementById("btn-connectors");
        var $connModal = document.getElementById("connectors-modal");
        var $connClose = document.getElementById("connectors-modal-close");
        if ($connBtn && $connModal) {
            $connBtn.addEventListener("click", function () {
                $connModal.classList.remove("hidden");
                updateConnectorStatuses();
            });
            $connClose.addEventListener("click", function () {
                $connModal.classList.add("hidden");
            });
            $connModal.addEventListener("click", function (e) {
                if (e.target === $connModal) $connModal.classList.add("hidden");
            });

            // Microsoft 365 connect
            var $ms365Btn = document.getElementById("conn-btn-ms365");
            if ($ms365Btn) {
                $ms365Btn.addEventListener("click", function () {
                    window.location.href = "/auth/microsoft?token=" + encodeURIComponent(authToken || "");
                });
            }

            // Slack setup
            var $slackBtn = document.getElementById("conn-btn-slack");
            if ($slackBtn) {
                $slackBtn.addEventListener("click", function () {
                    $connModal.classList.add("hidden");
                    window._sendSuggestion("How do I set up Slack integration? Give me step by step instructions.");
                });
            }

            // WhatsApp setup
            var $waBtn = document.getElementById("conn-btn-whatsapp");
            if ($waBtn) {
                $waBtn.addEventListener("click", function () {
                    $connModal.classList.add("hidden");
                    window._sendSuggestion("How do I set up WhatsApp integration with Twilio? Give me step by step instructions.");
                });
            }

            // Telegram setup
            var $tgBtn = document.getElementById("conn-btn-telegram");
            if ($tgBtn) {
                $tgBtn.addEventListener("click", function () {
                    $connModal.classList.add("hidden");
                    window._sendSuggestion("How do I set up Telegram bot integration? Give me step by step instructions.");
                });
            }
        }

        function updateConnectorStatuses() {
            fetch("/api/web/status")
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    var $ms365Status = document.getElementById("conn-status-ms365");
                    var $ms365Btn = document.getElementById("conn-btn-ms365");
                    if (data.graph) {
                        $ms365Status.textContent = "Connected";
                        $ms365Status.style.color = "var(--success)";
                        $ms365Btn.textContent = "Connected";
                        $ms365Btn.classList.add("connected");
                        $ms365Btn.disabled = true;
                    }

                    var $searchStatus = document.getElementById("conn-status-search");
                    var $searchBtn = document.getElementById("conn-btn-search");
                    if (data.search) {
                        $searchStatus.textContent = "Active";
                        $searchStatus.style.color = "var(--success)";
                        $searchBtn.textContent = "Connected";
                        $searchBtn.classList.add("connected");
                    } else {
                        $searchStatus.textContent = "Not active";
                        $searchBtn.textContent = "Enable";
                        $searchBtn.disabled = false;
                    }
                })
                .catch(function () {});
        }
    }

    function autoResize() {
        $input.style.height = "auto";
        $input.style.height = Math.min($input.scrollHeight, 150) + "px";
    }

    // -- Start --
    init();
})();
