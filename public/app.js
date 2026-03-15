const storageKey = "proxy-manager-admin-token";
const themeStorageKey = "proxy-manager-theme";
let toastTimerSeed = 0;

const state = {
  sources: [],
  builds: [],
  output: "",
  logs: [],
  logSummary: null,
  system: null,
  subscriptionVisible: false,
  activeSection: "overview",
  sidebarOpen: false,
  adminToken: window.sessionStorage.getItem(storageKey) || "",
  theme: window.localStorage.getItem(themeStorageKey) || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
  editingSourceId: null,
};

const elements = {
  toastStack: document.querySelector("#toastStack"),
  dashboardShell: document.querySelector(".dashboard-shell"),
  moduleSidebar: document.querySelector("#moduleSidebar"),
  sidebarToggleButton: document.querySelector("#sidebarToggleButton"),
  themeToggleButton: document.querySelector("#themeToggleButton"),
  authGate: document.querySelector("#authGate"),
  authForm: document.querySelector("#authForm"),
  adminTokenInput: document.querySelector("#adminTokenInput"),
  authError: document.querySelector("#authError"),
  logoutButton: document.querySelector("#logoutButton"),
  sourceForm: document.querySelector("#sourceForm"),
  sourceSubmitButton: document.querySelector("#sourceSubmitButton"),
  sourceCancelEditButton: document.querySelector("#sourceCancelEditButton"),
  sourceType: document.querySelector("#sourceType"),
  remoteSourceField: document.querySelector("#remoteSourceField"),
  inlineSourceField: document.querySelector("#inlineSourceField"),
  inlineSourceHint: document.querySelector("#inlineSourceHint"),
  sourcesList: document.querySelector("#sourcesList"),
  scriptEditor: document.querySelector("#scriptEditor"),
  scriptLineNumbers: document.querySelector("#scriptLineNumbers"),
  rawTopConfigContent: document.querySelector("#rawTopConfigContent"),
  scriptPreview: document.querySelector("#scriptPreview"),
  rawTopConfigPreview: document.querySelector("#rawTopConfigPreview"),
  outputPreview: document.querySelector("#outputPreview"),
  logsPreview: document.querySelector("#logsPreview"),
  logSummary: document.querySelector("#logSummary"),
  logTypeSelect: document.querySelector("#logTypeSelect"),
  logLevelSelect: document.querySelector("#logLevelSelect"),
  logSearchInput: document.querySelector("#logSearchInput"),
  reloadLogsButton: document.querySelector("#reloadLogsButton"),
  buildsList: document.querySelector("#buildsList"),
  statusBar: document.querySelector("#statusBar"),
  buildButton: document.querySelector("#buildButton"),
  openScriptEditorButton: document.querySelector("#openScriptEditorButton"),
  saveScriptButton: document.querySelector("#saveScriptButton"),
  resetScriptButton: document.querySelector("#resetScriptButton"),
  validateScriptButton: document.querySelector("#validateScriptButton"),
  scriptValidationResult: document.querySelector("#scriptValidationResult"),
  saveRawConfigButton: document.querySelector("#saveRawConfigButton"),
  saveSystemButton: document.querySelector("#saveSystemButton"),
  rotateTokenButton: document.querySelector("#rotateTokenButton"),
  toggleSubscriptionButton: document.querySelector("#toggleSubscriptionButton"),
  copySubscriptionButton: document.querySelector("#copySubscriptionButton"),
  openRawConfigEditorButton: document.querySelector("#openRawConfigEditorButton"),
  closeScriptModalButton: document.querySelector("#closeScriptModalButton"),
  closeRawConfigModalButton: document.querySelector("#closeRawConfigModalButton"),
  scriptModal: document.querySelector("#scriptModal"),
  rawConfigModal: document.querySelector("#rawConfigModal"),
  sourceContentModal: document.querySelector("#sourceContentModal"),
  closeSourceContentModalButton: document.querySelector("#closeSourceContentModalButton"),
  sourceContentTitle: document.querySelector("#sourceContentTitle"),
  sourceContentMeta: document.querySelector("#sourceContentMeta"),
  sourceContentPreview: document.querySelector("#sourceContentPreview"),
  reloadSourcesButton: document.querySelector("#reloadSourcesButton"),
  reloadOutputButton: document.querySelector("#reloadOutputButton"),
  subscriptionLink: document.querySelector("#subscriptionLink"),
  subscriptionUrl: document.querySelector("#subscriptionUrl"),
  autoRefreshEnabled: document.querySelector("#autoRefreshEnabled"),
  autoBuildEnabled: document.querySelector("#autoBuildEnabled"),
  refreshIntervalMinutes: document.querySelector("#refreshIntervalMinutes"),
  rawTopConfigEnabled: document.querySelector("#rawTopConfigEnabled"),
  systemSummary: document.querySelector("#systemSummary"),
  enabledSourcesStat: document.querySelector("#enabledSourcesStat"),
  healthySourcesStat: document.querySelector("#healthySourcesStat"),
  schedulerStatusStat: document.querySelector("#schedulerStatusStat"),
  schedulerMetaStat: document.querySelector("#schedulerMetaStat"),
  lastBuildStat: document.querySelector("#lastBuildStat"),
  buildMetaStat: document.querySelector("#buildMetaStat"),
  sidebarLinks: Array.from(document.querySelectorAll("[data-section-target]")),
  modulePanels: Array.from(document.querySelectorAll(".module-panel[data-section]")),
};

function setAdminToken(token) {
  state.adminToken = String(token || "").trim();
  if (state.adminToken) {
    window.sessionStorage.setItem(storageKey, state.adminToken);
  } else {
    window.sessionStorage.removeItem(storageKey);
  }
}

function applyTheme(theme, options = {}) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  state.theme = nextTheme;
  document.documentElement.dataset.theme = nextTheme;
  if (options.persist !== false) {
    window.localStorage.setItem(themeStorageKey, nextTheme);
  }
  elements.themeToggleButton.textContent = nextTheme === "dark" ? "浅色模式" : "暗黑模式";
  elements.themeToggleButton.setAttribute("aria-pressed", nextTheme === "dark" ? "true" : "false");
}

function showToast(message, tone = "neutral") {
  const toast = document.createElement("div");
  const toastId = `toast-${Date.now()}-${toastTimerSeed += 1}`;
  toast.className = "toast";
  toast.dataset.tone = tone;
  toast.dataset.toastId = toastId;
  toast.textContent = message;
  elements.toastStack.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add("visible");
  });

  const dismiss = () => {
    toast.classList.remove("visible");
    setTimeout(() => {
      toast.remove();
    }, 220);
  };

  toast.addEventListener("click", dismiss, { once: true });
  setTimeout(dismiss, tone === "error" ? 5000 : 3200);
}

function showErrorToast(error) {
  showToast(error?.message || String(error), "error");
}

function showAuthGate(message = "请输入管理令牌") {
  elements.authGate.classList.remove("hidden");
  elements.authGate.setAttribute("aria-hidden", "false");
  elements.authError.textContent = message;
  elements.authError.dataset.tone = message.includes("失败") || message.includes("无效") ? "error" : "neutral";
  elements.adminTokenInput.value = state.adminToken;
}

function hideAuthGate() {
  elements.authGate.classList.add("hidden");
  elements.authGate.setAttribute("aria-hidden", "true");
}

async function request(url, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (state.adminToken && options.skipAdminToken !== true) {
    headers["X-Admin-Token"] = state.adminToken;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (response.status === 401 && options.allowUnauthorized !== true) {
    setAdminToken("");
    showAuthGate("管理令牌无效或已过期，请重新输入。");
    throw new Error("管理令牌无效或已过期，请重新输入。");
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  return response.text();
}

function setStatus(message) {
  elements.statusBar.textContent = message;
}

function setValidationResult(message, tone = "neutral") {
  elements.scriptValidationResult.textContent = message;
  elements.scriptValidationResult.dataset.tone = tone;
}

function resetSourceForm() {
  state.editingSourceId = null;
  elements.sourceForm.reset();
  elements.sourceType.value = "remote";
  updateSourceFormVisibility();
  elements.sourceSubmitButton.textContent = "添加订阅源";
  elements.sourceCancelEditButton.classList.add("hidden");
}

function startSourceEdit(source) {
  state.editingSourceId = source.id;
  elements.sourceForm.elements.name.value = source.name || "";
  elements.sourceType.value = source.type || "remote";
  elements.sourceForm.elements.url.value = source.url || "";
  elements.sourceForm.elements.content.value = source.content || "";
  elements.sourceForm.elements.tags.value = Array.isArray(source.tags) ? source.tags.join(",") : "";
  updateSourceFormVisibility();
  elements.sourceSubmitButton.textContent = "保存修改";
  elements.sourceCancelEditButton.classList.remove("hidden");
  elements.sourceForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function updateSourceFormVisibility() {
  const type = elements.sourceType.value;
  const isInline = type === "inline";
  elements.remoteSourceField.classList.toggle("hidden", isInline);
  elements.inlineSourceField.classList.toggle("hidden", !isInline);
  elements.inlineSourceHint.classList.toggle("hidden", !isInline);
}

function updateScriptLineNumbers() {
  const lineCount = Math.max(1, elements.scriptEditor.value.split("\n").length);
  const numbers = Array.from({ length: lineCount }, (_, index) => String(index + 1)).join("\n");
  elements.scriptLineNumbers.textContent = numbers;
  elements.scriptLineNumbers.scrollTop = elements.scriptEditor.scrollTop;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function previewText(value, fallback = "点击按钮开始编辑") {
  const text = String(value || "").trim();
  return text ? text : fallback;
}

function getSourceLocationText(source) {
  if (source.type === "remote") return "远程订阅地址已隐藏";
  if (source.type === "inline") return "内联 YAML 内容";
  return source.url || source.filePath || "inline content";
}

function formatDate(value) {
  if (!value) return "未执行";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatBytes(value) {
  const size = Number(value || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function getStatusBadge(status) {
  if (status === "success") return '<span class="badge ok">正常</span>' ;
  if (status === "error") return '<span class="badge err">异常</span>' ;
  if (!status || status === "idle") return '<span class="badge">空闲</span>' ;
  return `<span class="badge">${escapeHtml(status)}</span>`;
}

function openModal(modal) {
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function closeModal(modal) {
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

function setSidebarOpen(open) {
  state.sidebarOpen = open;
  elements.dashboardShell.classList.toggle("sidebar-open", open);
  elements.sidebarToggleButton.setAttribute("aria-expanded", open ? "true" : "false");
}

function setActiveSection(sectionId) {
  state.activeSection = sectionId;
  elements.sidebarLinks.forEach(button => {
    const active = button.dataset.sectionTarget === sectionId;
    button.classList.toggle("active", active);
  });
  elements.modulePanels.forEach(panel => {
    panel.classList.toggle("active", panel.dataset.section === sectionId);
  });
  if (window.innerWidth <= 900) {
    setSidebarOpen(false);
  }
}

function renderNavigation() {
  elements.sidebarLinks.forEach(button => {
    button.classList.toggle("active", button.dataset.sectionTarget === state.activeSection);
  });
  elements.modulePanels.forEach(panel => {
    panel.classList.toggle("active", panel.dataset.section === state.activeSection);
  });
  elements.dashboardShell.classList.toggle("sidebar-open", state.sidebarOpen && window.innerWidth <= 900);
  elements.sidebarToggleButton.setAttribute("aria-expanded", state.sidebarOpen && window.innerWidth <= 900 ? "true" : "false");
}

function renderOverview() {
  const enabledSources = state.sources.filter(source => source.enabled).length;
  const healthySources = state.sources.filter(source => source.lastRefreshStatus === "success").length;
  const settings = state.system?.settings;

  elements.enabledSourcesStat.textContent = String(enabledSources);
  elements.healthySourcesStat.textContent = `健康订阅 ${healthySources}`;
  elements.schedulerStatusStat.textContent = settings?.lastSchedulerStatus || "idle";
  elements.schedulerMetaStat.textContent = settings?.lastSchedulerRunAt ? `最近调度 ${formatDate(settings.lastSchedulerRunAt)}` : "等待首次运行";
  elements.lastBuildStat.textContent = settings?.lastBuildAt ? formatDate(settings.lastBuildAt) : "未构建";
  elements.buildMetaStat.textContent = settings?.lastBuildStatus ? `状态 ${settings.lastBuildStatus}` : "等待输出";
}

function renderSystem() {
  if (!state.system) return;

  const { settings, subscriptionUrl } = state.system;
  elements.autoRefreshEnabled.checked = settings.autoRefreshEnabled;
  elements.autoBuildEnabled.checked = settings.autoBuildEnabled;
  elements.refreshIntervalMinutes.value = settings.refreshIntervalMinutes;
  elements.rawTopConfigEnabled.checked = settings.rawTopConfigEnabled;
  elements.rawTopConfigContent.value = settings.rawTopConfigContent || "";
  elements.rawTopConfigPreview.textContent = previewText(settings.rawTopConfigContent, "顶部配置块未设置");
  elements.subscriptionLink.href = subscriptionUrl;
  elements.subscriptionUrl.value = subscriptionUrl;
  elements.subscriptionUrl.classList.toggle("hidden", !state.subscriptionVisible);
  elements.toggleSubscriptionButton.textContent = state.subscriptionVisible ? "隐藏订阅地址" : "显示订阅地址";
  elements.systemSummary.innerHTML = `
    <div class="system-summary-grid">
      <article class="system-summary-card">
        <div class="system-summary-header">
          <span class="stat-label">调度任务</span>
          ${getStatusBadge(settings.lastSchedulerStatus)}
        </div>
        <strong class="system-summary-value">${formatDate(settings.lastSchedulerRunAt)}</strong>
        <div class="system-summary-note">${settings.autoRefreshEnabled ? `已开启自动刷新，每 ${settings.refreshIntervalMinutes} 分钟运行一次` : "自动刷新已关闭，仅手动触发"}</div>
      </article>
      <article class="system-summary-card">
        <div class="system-summary-header">
          <span class="stat-label">输出构建</span>
          ${getStatusBadge(settings.lastBuildStatus)}
        </div>
        <strong class="system-summary-value">${formatDate(settings.lastBuildAt)}</strong>
        <div class="system-summary-note">${settings.autoBuildEnabled ? "源数据刷新后会自动生成输出" : "自动构建已关闭"}</div>
      </article>
      <article class="system-summary-card">
        <div class="system-summary-header">
          <span class="stat-label">配置注入</span>
          <span class="badge">${settings.rawTopConfigEnabled ? "已启用" : "未启用"}</span>
        </div>
        <strong class="system-summary-value">${settings.rawTopConfigEnabled ? "顶部配置块生效中" : "当前未合并顶部配置块"}</strong>
        <div class="system-summary-note">预览已同步到编辑器，保存设置后会在下次构建时应用</div>
      </article>
      <article class="system-summary-card">
        <div class="system-summary-header">
          <span class="stat-label">发布地址</span>
          <span class="badge">${settings.publicBaseUrl ? "已设置" : "自动推断"}</span>
        </div>
        <strong class="system-summary-value">${escapeHtml(settings.publicBaseUrl || "跟随当前请求地址")}</strong>
        <div class="system-summary-note">安全订阅链接已生成，可按需显示、复制或轮换令牌</div>
      </article>
    </div>
    ${settings.lastSchedulerError ? `<div class="system-summary-error">最近调度错误：${escapeHtml(settings.lastSchedulerError)}</div>` : ""}
  `;
  renderOverview();
}

function renderSources() {
  if (state.sources.length === 0) {
    elements.sourcesList.innerHTML = '<div class="source-card">\u8fd8\u6ca1\u6709\u8ba2\u9605\u6e90\uff0c\u5148\u6dfb\u52a0\u4e00\u4e2a\u6765\u6e90\u5f00\u59cb\u5de5\u4f5c\u3002</div>';
    renderOverview();
    return;
  }

  elements.sourcesList.innerHTML = state.sources.map(source => {
    const refreshBadge = source.lastRefreshStatus === "success"
      ? '<span class="badge ok">\u5237\u65b0\u6210\u529f</span>'
      : source.lastRefreshStatus === "error"
        ? '<span class="badge err">\u5237\u65b0\u5931\u8d25</span>'
        : '<span class="badge">\u672a\u5237\u65b0</span>';

    return `
      <article class="source-card">
        <div><strong>${escapeHtml(source.name)}</strong></div>
        <div class="source-meta">${escapeHtml(source.type)} \u00b7 ${source.enabled ? "\u542f\u7528" : "\u7981\u7528"} \u00b7 ${source.lastBuildIncluded ? "\u5df2\u53c2\u4e0e\u6700\u8fd1\u6784\u5efa" : "\u672a\u53c2\u4e0e\u6700\u8fd1\u6784\u5efa"}</div>
        <div class="source-meta">${escapeHtml(getSourceLocationText(source))}</div>
        <div>${refreshBadge}${(source.tags || []).map(tag => `<span class="badge">${escapeHtml(tag)}</span>`).join("")}</div>
        <div class="source-meta">\u6700\u8fd1\u5237\u65b0\uff1a${escapeHtml(formatDate(source.lastRefreshAt))}${source.lastRefreshError ? ` \u00b7 \u9519\u8bef\uff1a${escapeHtml(source.lastRefreshError)}` : ""}</div>
        <div class="inline-actions">
          <button class="button-secondary" data-action="toggle" data-id="${source.id}">${source.enabled ? "\u7981\u7528" : "\u542f\u7528"}</button>
          <button class="button-secondary" data-action="edit" data-id="${source.id}">\u7f16\u8f91</button>
          <button class="button-secondary" data-action="refresh" data-id="${source.id}">\u5237\u65b0</button>
          <button class="button-secondary" data-action="content" data-id="${source.id}">\u67e5\u770b\u539f\u6587</button>
          <button class="button-secondary" data-action="delete" data-id="${source.id}">\u5220\u9664</button>
        </div>
      </article>
    `;
  }).join("");

  renderOverview();
}

function renderBuilds() {
  if (state.builds.length === 0) {
    elements.buildsList.innerHTML = '<div class="build-card">还没有构建记录。</div>';
    return;
  }

  elements.buildsList.innerHTML = state.builds.slice(0, 8).map(build => `
    <article class="build-card">
      <div><strong>${escapeHtml(build.id)}</strong></div>
      <div class="build-meta">${escapeHtml(build.status)} · ${escapeHtml(formatDate(build.createdAt))}</div>
      <div class="build-meta">触发方式 ${escapeHtml(build.trigger || "manual")} · 节点 ${build.proxyCount} · 分组 ${build.groupCount}</div>
    </article>
  `).join("");
}

function getLogGroupKey(entry) {
  const dateKey = String(entry.timestamp || "").slice(0, 10) || "unknown-date";
  return `${entry.type || "unknown"}:${dateKey}`;
}

function formatLogHeading(entry) {
  const typeLabel = entry.type === "audit" ? "审计日志" : entry.type === "app" ? "应用日志" : "其他日志";
  const dateLabel = String(entry.timestamp || "").slice(0, 10) || "未知日期";
  return `${typeLabel} / ${dateLabel}`;
}

function getLogTone(entry) {
  if (entry.level === "error" || entry.outcome === "error" || entry.outcome === "deny") return "err";
  if (entry.level === "warn") return "warn";
  return "ok";
}

function getLogPrimaryText(entry) {
  return entry.message || entry.error || entry.outcome || "无附加说明";
}

function getLogHighlights(entry) {
  const pairs = [
    ["客户端", entry.client],
    ["来源", entry.sourceId || entry.sourceName],
    ["构建", entry.buildId],
    ["状态", entry.status],
    ["触发", entry.trigger],
    ["路径", entry.path],
    ["方法", entry.method],
    ["模式", entry.mode],
  ];

  return pairs
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .slice(0, 4);
}

function formatLogEntry(entry) {
  const tone = getLogTone(entry);
  const levelLabel = entry.level ? String(entry.level).toUpperCase() : entry.outcome ? String(entry.outcome).toUpperCase() : "EVENT";
  const eventLabel = entry.action || entry.event || "log.entry";
  const primaryText = getLogPrimaryText(entry);
  const highlights = getLogHighlights(entry);
  const detail = escapeHtml(JSON.stringify(entry, null, 2));

  return `
    <article class="log-entry-card" data-tone="${tone}">
      <div class="log-entry-head">
        <div class="log-entry-title">
          <span class="badge ${tone === "err" ? "err" : tone === "warn" ? "" : "ok"}">${escapeHtml(levelLabel)}</span>
          <strong>${escapeHtml(eventLabel)}</strong>
        </div>
        <span class="source-meta">${escapeHtml(formatDate(entry.timestamp))}</span>
      </div>
      <div class="log-entry-summary">${escapeHtml(primaryText)}</div>
      ${highlights.length > 0 ? `
        <div class="log-meta-row">
          ${highlights.map(([label, value]) => `<span class="log-meta-pill"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(String(value))}</span></span>`).join("")}
        </div>
      ` : ""}
      <details class="log-entry-details">
        <summary>查看原始详情</summary>
        <pre class="log-entry-detail">${detail}</pre>
      </details>
    </article>
  `;
}

function renderLogs() {
  if (!state.logSummary) {
    elements.logSummary.textContent = "日志尚未加载。";
  } else {
    const audit = state.logSummary.audit || { exists: false, sizeBytes: 0, fileCount: 0, updatedAt: null };
    const app = state.logSummary.app || { exists: false, sizeBytes: 0, fileCount: 0, updatedAt: null };
    elements.logSummary.innerHTML = `
      <div class="log-summary-grid">
        <article class="log-summary-card">
          <span class="stat-label">审计日志</span>
          <strong>${audit.exists ? `${audit.fileCount} 天` : "未生成"}</strong>
          <span class="stat-meta">${audit.exists ? `${formatBytes(audit.sizeBytes)} · 最近 ${escapeHtml(formatDate(audit.updatedAt))}` : "等待首条记录"}</span>
        </article>
        <article class="log-summary-card">
          <span class="stat-label">应用日志</span>
          <strong>${app.exists ? `${app.fileCount} 天` : "未生成"}</strong>
          <span class="stat-meta">${app.exists ? `${formatBytes(app.sizeBytes)} · 最近 ${escapeHtml(formatDate(app.updatedAt))}` : "等待首条记录"}</span>
        </article>
      </div>
    `;
  }

  if (!state.logs || state.logs.length === 0) {
    elements.logsPreview.innerHTML = '<div class="log-empty">还没有匹配的日志。</div>';
    return;
  }

  const groups = [];
  for (const entry of state.logs) {
    const groupKey = getLogGroupKey(entry);
    let group = groups.find(item => item.key === groupKey);
    if (!group) {
      group = {
        key: groupKey,
        heading: formatLogHeading(entry),
        entries: [],
      };
      groups.push(group);
    }
    group.entries.push(entry);
  }

  elements.logsPreview.innerHTML = groups.map(group => `
    <section class="log-group">
      <div class="log-group-head">
        <strong>${escapeHtml(group.heading)}</strong>
        <span class="source-meta">${group.entries.length} 条</span>
      </div>
      <div class="log-group-list">
        ${group.entries.map(formatLogEntry).join("")}
      </div>
    </section>
  `).join("");
}

async function loadSources() {
  state.sources = await request("/api/sources");
  renderSources();
}

async function loadScript() {
  const result = await request("/api/scripts/current");
  elements.scriptEditor.value = result.content;
  elements.scriptPreview.textContent = previewText(result.content, "脚本未设置");
  updateScriptLineNumbers();
  setValidationResult("尚未校验", "neutral");
}

async function loadBuilds() {
  state.builds = await request("/api/builds");
  renderBuilds();
}

async function loadSystem() {
  state.system = await request("/api/system/status");
  renderSystem();
}

async function loadOutput() {
  try {
    const result = await request("/api/output/content");
    state.output = result.content;
    elements.outputPreview.textContent = result.content;
  } catch {
    state.output = "";
    elements.outputPreview.textContent = "还没有生成输出。";
  }
}

async function loadLogs() {
  const params = new URLSearchParams({
    type: elements.logTypeSelect.value,
    limit: "120",
  });

  if (elements.logLevelSelect.value) {
    params.set("level", elements.logLevelSelect.value);
  }

  if (elements.logSearchInput.value.trim()) {
    params.set("search", elements.logSearchInput.value.trim());
  }

  const result = await request(`/api/logs?${params.toString()}`);
  state.logs = result.entries;
  state.logSummary = result.summary;
  renderLogs();
}

async function bootstrap() {
  updateSourceFormVisibility();
  renderNavigation();

  if (!state.adminToken) {
    showAuthGate();
    setStatus("控制台已锁定，等待输入管理令牌。");
    return;
  }

  hideAuthGate();
  setStatus("正在加载控制台...");
  await Promise.all([loadSystem(), loadSources(), loadScript(), loadBuilds(), loadOutput(), loadLogs()]);
  renderNavigation();
  setStatus("控制台已就绪");
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const token = elements.adminTokenInput.value.trim();
  elements.authError.textContent = "正在验证管理令牌...";
  elements.authError.dataset.tone = "neutral";

  const result = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ token }),
    skipAdminToken: true,
    allowUnauthorized: true,
  });

  setAdminToken(token);
  state.system = result;
  hideAuthGate();
  await Promise.all([loadSources(), loadScript(), loadBuilds(), loadOutput(), loadLogs()]);
  renderNavigation();
  renderSystem();
  setStatus("控制台已解锁");
  showToast("控制台已解锁", "ok");
}

function handleLogout() {
  setAdminToken("");
  setSidebarOpen(false);
  showAuthGate("控制台已锁定，请重新输入管理令牌。");
  setStatus("控制台已锁定");
  showToast("控制台已锁定", "warn");
}

async function handleAddSource(event) {
  event.preventDefault();
  const formData = new FormData(elements.sourceForm);
  const payload = {
    name: formData.get("name"),
    type: formData.get("type"),
    url: formData.get("url"),
    content: formData.get("content"),
    tags: String(formData.get("tags") || "").split(",").map(item => item.trim()).filter(Boolean),
  };

  const isEditing = Boolean(state.editingSourceId);
  setStatus(isEditing ? "\u6b63\u5728\u4fdd\u5b58\u8ba2\u9605\u6e90..." : "\u6b63\u5728\u6dfb\u52a0\u8ba2\u9605\u6e90...");
  await request(isEditing ? `/api/sources/${state.editingSourceId}` : "/api/sources", {
    method: isEditing ? "PUT" : "POST",
    body: JSON.stringify(payload),
  });
  resetSourceForm();
  await Promise.all([loadSources(), loadLogs()]);
  setStatus(isEditing ? "\u8ba2\u9605\u6e90\u5df2\u66f4\u65b0" : "\u8ba2\u9605\u6e90\u5df2\u6dfb\u52a0");
  showToast(isEditing ? "\u8ba2\u9605\u6e90\u5df2\u66f4\u65b0" : "\u8ba2\u9605\u6e90\u5df2\u6dfb\u52a0", "ok");
}

async function handleViewSourceContent(source) {
  setStatus(`\u6b63\u5728\u52a0\u8f7d ${source.name} \u7684\u539f\u6587...`);
  elements.sourceContentTitle.textContent = `${source.name} \u539f\u6587`;
  elements.sourceContentMeta.textContent = "\u6b63\u5728\u52a0\u8f7d...";
  elements.sourceContentMeta.dataset.tone = "neutral";
  elements.sourceContentPreview.textContent = "";
  openModal(elements.sourceContentModal);

  try {
    const result = await request(`/api/sources/${source.id}/content`);
    const modeText = result.mode === "cache"
      ? "\u8fdc\u7a0b\u7f13\u5b58"
      : result.mode === "live"
        ? "\u8fdc\u7a0b\u5b9e\u65f6\u62c9\u53d6"
        : "\u5185\u8054\u5185\u5bb9";
    elements.sourceContentMeta.textContent = `\u6765\u6e90\uff1a${source.type}\uff1b\u8bfb\u53d6\u65b9\u5f0f\uff1a${modeText}\uff1b\u5b57\u7b26\u6570\uff1a${result.content.length}`;
    elements.sourceContentMeta.dataset.tone = "ok";
    elements.sourceContentPreview.textContent = result.content || "\u8be5\u8ba2\u9605\u5f53\u524d\u6ca1\u6709\u5185\u5bb9\u3002";
    setStatus(`${source.name} \u539f\u6587\u5df2\u52a0\u8f7d`);
  } catch (error) {
    elements.sourceContentMeta.textContent = `\u52a0\u8f7d\u5931\u8d25\uff1a${error.message}`;
    elements.sourceContentMeta.dataset.tone = "error";
    elements.sourceContentPreview.textContent = "";
    setStatus(error.message);
    throw error;
  }
}

async function handleSourceAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const { action, id } = button.dataset;
  const source = state.sources.find(item => item.id === id);
  if (!source) return;

  if (action === "toggle") {
    setStatus(`\u6b63\u5728${source.enabled ? "\u7981\u7528" : "\u542f\u7528"} ${source.name}...`);
    await request(`/api/sources/${id}`, { method: "PUT", body: JSON.stringify({ enabled: !source.enabled }) });
    await Promise.all([loadSources(), loadLogs()]);
    setStatus(`${source.name} \u5df2\u66f4\u65b0`);
    showToast(`${source.name} \u5df2${source.enabled ? "\u7981\u7528" : "\u542f\u7528"}`, "ok");
  }

  if (action === "edit") {
    startSourceEdit(source);
    setStatus(`\u6b63\u5728\u7f16\u8f91 ${source.name}`);
    showToast(`\u5df2\u8f7d\u5165 ${source.name} \u7684\u914d\u7f6e`, "ok");
  }

  if (action === "refresh") {
    setStatus(`\u6b63\u5728\u5237\u65b0 ${source.name}...`);
    await request(`/api/sources/${id}/refresh`, { method: "POST" });
    await Promise.all([loadSources(), loadSystem(), loadLogs()]);
    setStatus(`${source.name} \u5df2\u5237\u65b0`);
    showToast(`${source.name} \u5df2\u5237\u65b0`, "ok");
  }

  if (action === "content") {
    await handleViewSourceContent(source);
  }

  if (action === "delete") {
    setStatus(`\u6b63\u5728\u5220\u9664 ${source.name}...`);
    await request(`/api/sources/${id}`, { method: "DELETE" });
    if (state.editingSourceId === id) {
      resetSourceForm();
    }
    await Promise.all([loadSources(), loadLogs()]);
    setStatus(`${source.name} \u5df2\u5220\u9664`);
    showToast(`${source.name} \u5df2\u5220\u9664`, "warn");
  }
}

async function handleValidateScript() {
  setStatus("正在校验脚本...");

  try {
    const result = await request("/api/scripts/validate", {
      method: "POST",
      body: JSON.stringify({ content: elements.scriptEditor.value }),
    });
    setValidationResult(result.message, result.warningCount > 0 ? "warn" : "ok");
    setStatus(result.message);
    showToast(result.message, result.warningCount > 0 ? "warn" : "ok");
    await loadLogs();
    return result;
  } catch (error) {
    setValidationResult(`校验失败：${error.message}`, "error");
    setStatus(error.message);
    await loadLogs().catch(() => {});
    throw error;
  }
}

async function handleResetScript() {
  setStatus("正在恢复默认脚本...");
  const result = await request("/api/scripts/reset", { method: "POST" });
  elements.scriptEditor.value = result.content;
  elements.scriptPreview.textContent = previewText(result.content, "脚本未设置");
  updateScriptLineNumbers();
  setValidationResult("已恢复为默认脚本，建议直接保存或再次修改。", "warn");
  setStatus("默认脚本已恢复到编辑器");
  showToast("默认脚本已恢复到编辑器", "warn");
  await loadLogs();
}

async function handleOpenScriptEditor() {
  await loadScript();
  openModal(elements.scriptModal);
}

async function handleSaveScript() {
  setStatus("正在校验并保存脚本...");

  try {
    const result = await request("/api/scripts/current", { method: "PUT", body: JSON.stringify({ content: elements.scriptEditor.value }) });
    elements.scriptPreview.textContent = previewText(elements.scriptEditor.value, "脚本未设置");
    setValidationResult(result.validation.message, result.validation.warningCount > 0 ? "warn" : "ok");
    closeModal(elements.scriptModal);
    setStatus(`脚本已保存。${result.validation.message}`);
    showToast("脚本已保存", "ok");
    await loadLogs();
  } catch (error) {
    setValidationResult(`保存失败：${error.message}`, "error");
    setStatus(error.message);
    await loadLogs().catch(() => {});
    throw error;
  }
}

async function handleSaveRawConfig() {
  setStatus("正在保存顶部配置块并重建输出...");
  elements.rawTopConfigPreview.textContent = previewText(elements.rawTopConfigContent.value, "顶部配置块未设置");
  await handleSaveSystem({ rebuildOutput: true, skipToast: true });
  await Promise.all([loadSystem(), loadSources(), loadBuilds(), loadOutput(), loadLogs()]);
  closeModal(elements.rawConfigModal);
  setStatus("顶部配置块已保存，输出已重建");
  showToast("顶部配置块已保存，输出已重建", "ok");
}

async function handleBuild() {
  setStatus("正在构建最终配置...");
  const result = await request("/api/build", { method: "POST" });
  await Promise.all([loadSystem(), loadSources(), loadBuilds(), loadOutput(), loadLogs()]);
  setStatus(`构建完成：${result.proxyCount} 个节点，${result.groupCount} 个分组`);
  showToast(`构建完成：${result.proxyCount} 个节点，${result.groupCount} 个分组`, "ok");
}

async function handleSaveSystem(options = {}) {
  setStatus("正在保存自动化设置...");
  const result = await request("/api/system/settings", {
    method: "PUT",
    body: JSON.stringify({
      autoRefreshEnabled: elements.autoRefreshEnabled.checked,
      autoBuildEnabled: elements.autoBuildEnabled.checked,
      refreshIntervalMinutes: Number(elements.refreshIntervalMinutes.value || 30),
      rawTopConfigEnabled: elements.rawTopConfigEnabled.checked,
      rawTopConfigContent: elements.rawTopConfigContent.value,
      rebuildOutput: options.rebuildOutput === true,
    }),
  });
  state.system = result;
  renderSystem();
  const message = options.rebuildOutput === true ? "自动化设置已保存，输出已重建" : "自动化设置已保存";
  setStatus(message);
  if (options.skipToast !== true) {
    showToast(message, "ok");
  }
  await loadLogs();
  return result;
}

async function handleRotateToken() {
  setStatus("正在轮换订阅令牌...");
  await request("/api/system/rotate-token", { method: "POST" });
  await Promise.all([loadSystem(), loadLogs()]);
  setStatus("订阅令牌已轮换，旧链接已失效");
  showToast("订阅令牌已轮换，旧链接已失效", "warn");
}

async function handleCopySubscription() {
  if (!state.system?.subscriptionUrl) return;
  await navigator.clipboard.writeText(state.system.subscriptionUrl);
  setStatus("订阅地址已复制到剪贴板");
  showToast("订阅地址已复制到剪贴板", "ok");
}

function handleToggleSubscription() {
  state.subscriptionVisible = !state.subscriptionVisible;
  renderSystem();
}

document.addEventListener("click", event => {
  const closeType = event.target.getAttribute("data-close-modal");
  if (closeType === "script") closeModal(elements.scriptModal);
  if (closeType === "raw") closeModal(elements.rawConfigModal);
  if (closeType === "source-content") closeModal(elements.sourceContentModal);
});

elements.sidebarToggleButton.addEventListener("click", () => {
  setSidebarOpen(!state.sidebarOpen);
  renderNavigation();
});

elements.themeToggleButton.addEventListener("click", () => {
  applyTheme(state.theme === "dark" ? "light" : "dark");
  showToast(state.theme === "dark" ? "已切换到暗黑模式" : "已切换到浅色模式", "ok");
});

elements.moduleSidebar.addEventListener("click", event => {
  const button = event.target.closest("[data-section-target]");
  if (!button) return;
  setActiveSection(button.dataset.sectionTarget);
  renderNavigation();
});

window.addEventListener("resize", () => {
  if (window.innerWidth > 900) {
    state.sidebarOpen = false;
  }
  renderNavigation();
});

elements.authForm.addEventListener("submit", event => { handleAuthSubmit(event).catch(error => {
  elements.authError.textContent = `登录失败：${error.message}`;
  elements.authError.dataset.tone = "error";
  showErrorToast(error);
}); });
elements.logoutButton.addEventListener("click", handleLogout);
elements.sourceType.addEventListener("change", updateSourceFormVisibility);
elements.sourceCancelEditButton.addEventListener("click", () => { resetSourceForm(); setStatus("\u5df2\u53d6\u6d88\u7f16\u8f91"); });
elements.sourceForm.addEventListener("submit", event => { setActiveSection("sources"); handleAddSource(event).catch(error => { setStatus(error.message); showErrorToast(error); }); });
elements.sourcesList.addEventListener("click", event => { setActiveSection("sources"); handleSourceAction(event).catch(error => { setStatus(error.message); showErrorToast(error); }); });
elements.buildButton.addEventListener("click", () => { setActiveSection("builds"); handleBuild().catch(error => { setStatus(error.message); showErrorToast(error); }); });
elements.saveSystemButton.addEventListener("click", () => { setActiveSection("settings"); handleSaveSystem().catch(error => { setStatus(error.message); showErrorToast(error); }); });
elements.rotateTokenButton.addEventListener("click", () => { setActiveSection("overview"); handleRotateToken().catch(error => { setStatus(error.message); showErrorToast(error); }); });
elements.toggleSubscriptionButton.addEventListener("click", () => { setActiveSection("overview"); handleToggleSubscription(); });
elements.copySubscriptionButton.addEventListener("click", () => { setActiveSection("overview"); handleCopySubscription().catch(error => { setStatus(error.message); showErrorToast(error); }); });
elements.reloadSourcesButton.addEventListener("click", () => { setActiveSection("sources"); Promise.all([loadSystem(), loadSources()]).then(() => { setStatus("订阅源列表已刷新"); showToast("订阅源列表已刷新", "ok"); }).catch(error => { setStatus(error.message); showErrorToast(error); }); });
elements.reloadOutputButton.addEventListener("click", () => { setActiveSection("builds"); Promise.all([loadSystem(), loadBuilds(), loadOutput()]).then(() => { setStatus("输出信息已刷新"); showToast("输出信息已刷新", "ok"); }).catch(error => { setStatus(error.message); showErrorToast(error); }); });
elements.reloadLogsButton.addEventListener("click", () => { setActiveSection("logs"); loadLogs().then(() => { setStatus("日志已刷新"); showToast("日志已刷新", "ok"); }).catch(error => { setStatus(error.message); showErrorToast(error); }); });
elements.logTypeSelect.addEventListener("change", () => { setActiveSection("logs"); loadLogs().catch(error => { setStatus(error.message); showErrorToast(error); }); });
elements.logLevelSelect.addEventListener("change", () => { setActiveSection("logs"); loadLogs().catch(error => { setStatus(error.message); showErrorToast(error); }); });
elements.logSearchInput.addEventListener("change", () => { setActiveSection("logs"); loadLogs().catch(error => { setStatus(error.message); showErrorToast(error); }); });
elements.openScriptEditorButton.addEventListener("click", () => { setActiveSection("transform"); handleOpenScriptEditor().catch(error => { setStatus(error.message); showErrorToast(error); }); });
elements.closeScriptModalButton.addEventListener("click", () => closeModal(elements.scriptModal));
elements.closeSourceContentModalButton.addEventListener("click", () => closeModal(elements.sourceContentModal));
elements.scriptEditor.addEventListener("input", () => {
  updateScriptLineNumbers();
  setValidationResult("脚本已修改，保存时会自动校验。", "warn");
});
elements.scriptEditor.addEventListener("scroll", updateScriptLineNumbers);
elements.resetScriptButton.addEventListener("click", () => { setActiveSection("transform"); handleResetScript().catch(error => { setStatus(error.message); showErrorToast(error); }); });
elements.validateScriptButton.addEventListener("click", () => { setActiveSection("transform"); handleValidateScript().catch(error => { setStatus(error.message); showErrorToast(error); }); });
elements.saveScriptButton.addEventListener("click", () => { setActiveSection("transform"); handleSaveScript().catch(error => { setStatus(error.message); showErrorToast(error); }); });
elements.openRawConfigEditorButton.addEventListener("click", () => { setActiveSection("settings"); openModal(elements.rawConfigModal); });
elements.closeRawConfigModalButton.addEventListener("click", () => closeModal(elements.rawConfigModal));
elements.saveRawConfigButton.addEventListener("click", () => { setActiveSection("settings"); handleSaveRawConfig().catch(error => { setStatus(error.message); showErrorToast(error); }); });

applyTheme(state.theme, { persist: false });
bootstrap().catch(error => { setStatus(error.message); showErrorToast(error); });













