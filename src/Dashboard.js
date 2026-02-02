import React, { useState, useMemo, useEffect, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, AreaChart, Area
} from "recharts";
import {
  Building2, TrendingUp, DollarSign, Home, MapPin, Filter, ChevronDown,
  ChevronUp, X, SlidersHorizontal, Search, Download, Calendar, RefreshCw,
  Loader2, AlertCircle, Wifi, WifiOff, Clock
} from "lucide-react";

// ─── API CONFIGURATION ────────────────────────────────────────────────────────
const API_CONFIG = {
  baseUrl: process.env.REACT_APP_API_BASE_URL || "https://geobrain.com.br/public-api",
  credentials: {
    email: process.env.REACT_APP_API_EMAIL || "wesley.santos@piemonte.com.br",
    password: process.env.REACT_APP_API_PASSWORD || "wesley@2024@",
  },
};

// ─── API SERVICE (singleton) ──────────────────────────────────────────────────
class GeoBrainApiService {
  constructor() {
    this.token = null;
    this.tokenExpiresAt = 0;
    this.refreshPromise = null;
  }

  isTokenExpired() {
    if (!this.token) return true;
    // 60-second buffer before actual expiry
    return Date.now() >= this.tokenExpiresAt - 60000;
  }

  parseTokenExpiry(token) {
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      return payload.exp * 1000;
    } catch {
      // default 50 min if we can't parse
      return Date.now() + 50 * 60 * 1000;
    }
  }

  async login() {
    // Deduplicate concurrent login calls
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = (async () => {
      try {
        const res = await fetch(`${API_CONFIG.baseUrl}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(API_CONFIG.credentials),
        });
        if (!res.ok) throw new Error(`Login failed: ${res.status}`);
        const data = await res.json();
        this.token = data.token || data.access_token;
        this.tokenExpiresAt = this.parseTokenExpiry(this.token);
        return this.token;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  async ensureValidToken() {
    if (this.isTokenExpired()) await this.login();
    return this.token;
  }

  async request(endpoint, options = {}, retryCount = 0) {
    await this.ensureValidToken();

    const res = await fetch(`${API_CONFIG.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${this.token}`,
        ...options.headers,
      },
    });

    if (res.status === 401 && retryCount < 2) {
      this.token = null;
      await this.login();
      return this.request(endpoint, options, retryCount + 1);
    }

    if (!res.ok) throw new Error(`API Error: ${res.status}`);
    return res.json();
  }

  async fetchAllEmpreendimentos(onProgress) {
    let allData = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const response = await this.request(`/empreendimentos?page=${page}&per_page=${perPage}`);
      if (!response.data || response.data.length === 0) break;

      allData = [...allData, ...response.data];
      if (onProgress) {
        onProgress({ loaded: allData.length, total: response.meta?.total || allData.length, page });
      }

      const hasMore = response.meta ? page < response.meta.last_page : response.data.length === perPage;
      if (!hasMore) break;
      page++;
    }

    return allData;
  }

  transformData(apiData) {
    return apiData.map((emp, index) => ({
      id: emp.id || index,
      nome: emp.nome || emp.empreendimento || emp.name || "N/A",
      cidade: emp.cidade || emp.city || "N/A",
      estado: emp.estado || emp.uf || emp.state || "N/A",
      bairro: emp.bairro || emp.neighborhood || "N/A",
      incorporadora: emp.incorporadora || emp.construtora || emp.developer || "N/A",
      tipo: emp.tipo || emp.type || "Vertical",
      padrao: emp.padrao || emp.standard || "Standard",
      tipoImovel: emp.tipologia || emp.tipo_imovel || emp.property_type || "Padrao",
      quartos: parseInt(emp.quartos || emp.dormitorios || emp.bedrooms || 2),
      vgvTotal: parseFloat(emp.vgv_total || emp.vgv || emp.total_value || 0),
      vgvVendido: parseFloat(emp.vgv_vendido || emp.sold_value || 0),
      unidadesVendidas: parseInt(emp.unidades_vendidas || emp.sold_units || 0),
      totalUnidades: parseInt(emp.total_unidades || emp.unidades || emp.total_units || 0),
      preco: parseFloat(emp.preco_medio || emp.ticket_medio || emp.average_price || 0),
      m2: parseFloat(emp.area_privativa || emp.m2 || emp.private_area || 0),
      valorM2: parseFloat(emp.valor_m2 || emp.price_per_sqm || 0),
      status: emp.status || "Comercializacao",
      anoLancamento: parseInt(emp.ano_lancamento || emp.ano || emp.launch_year || new Date().getFullYear()),
      dataAtualizacao: emp.updated_at || emp.data_atualizacao || new Date().toISOString(),
    }));
  }

  async fetchCompleteData(onProgress) {
    const rawData = await this.fetchAllEmpreendimentos(onProgress);
    return this.transformData(rawData);
  }
}

const apiService = new GeoBrainApiService();

// ─── THEME ────────────────────────────────────────────────────────────────────
const COLORS = {
  primary: "#1A665B",
  accent: "#00B871",
  success: "#5CAA8A",
  warning: "#F59E0B",
  danger: "#EF4444",
  text: "#FFFFFF",
  textMuted: "#A3C6B8",
  border: "#5CAA8A",
  card: "rgba(26, 102, 91, 0.7)",
  sidebar: "#153D36",
};

const CHART_COLORS = ["#00B871", "#1A665B", "#5CAA8A", "#A3C6B8", "#363636", "#00956A", "#2D8B7A", "#78BFA8"];
const LINE_COLORS = ["#00B871", "#1A665B", "#5CAA8A", "#00956A", "#2D8B7A", "#78BFA8"];

// ─── UTILITIES ────────────────────────────────────────────────────────────────
const formatCurrency = (v) => {
  if (!v || isNaN(v)) return "R$ 0";
  if (v >= 1e9) return `R$ ${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `R$ ${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `R$ ${(v / 1e3).toFixed(0)}K`;
  return `R$ ${v.toFixed(0)}`;
};

const formatNumber = (v) => new Intl.NumberFormat("pt-BR").format(v || 0);

const formatDateTime = (date) =>
  new Date(date).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

// ─── LOGO ─────────────────────────────────────────────────────────────────────
const PiemonteLogo = ({ size = 24, color = "#00B871" }) => (
  <svg width={size} height={size * 0.8} viewBox="0 0 100 80" fill="none">
    <rect x="5" y="50" width="18" height="25" fill={color} rx="2" />
    <rect x="28" y="35" width="18" height="40" fill={color} rx="2" />
    <rect x="51" y="20" width="18" height="55" fill={color} rx="2" />
    <rect x="74" y="5" width="18" height="70" fill={color} rx="2" />
  </svg>
);

// ─── PDF GENERATOR ────────────────────────────────────────────────────────────
const generatePDF = (filteredData, kpis) => {
  const rows = [...filteredData]
    .sort((a, b) => b.vgvTotal - a.vgvTotal)
    .slice(0, 20)
    .map(
      (e, i) =>
        `<tr><td>${i + 1}</td><td>${e.nome}</td><td>${e.cidade}/${e.estado}</td><td>${e.incorporadora}</td><td>${e.anoLancamento}</td><td>${formatCurrency(e.vgvTotal)}</td><td>${formatCurrency(e.vgvVendido)}</td></tr>`
    )
    .join("");

  const html = `<!DOCTYPE html><html><head><title>Relatorio Piemonte</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',Arial;padding:40px;color:#363636}.header{text-align:center;margin-bottom:40px;padding-bottom:20px;border-bottom:3px solid #00B871}.header h1{font-size:28px;color:#1A665B}.header p{color:#5CAA8A;font-size:14px;margin-top:8px}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:40px}.kpi{background:linear-gradient(135deg,#E6E2DA,#FFFFFF);padding:20px;border-radius:12px;text-align:center;border-left:4px solid #00B871}.kpi-value{font-size:24px;font-weight:700;color:#1A665B}.kpi-label{font-size:12px;color:#5CAA8A;text-transform:uppercase;margin-top:4px}table{width:100%;border-collapse:collapse;font-size:11px}th{background:#1A665B;color:white;padding:12px 8px;text-align:left}td{padding:10px 8px;border-bottom:1px solid #A3C6B8}tr:nth-child(even){background:#E6E2DA}.footer{margin-top:40px;text-align:center;font-size:11px;color:#5CAA8A;border-top:2px solid #00B871;padding-top:20px}</style></head><body><div class="header"><h1>Relatorio Mercado Imobiliario</h1><p><strong>Piemonte</strong> - Pensado. Construido. Feito pra voce.</p></div><div class="kpis"><div class="kpi"><div class="kpi-value">${formatCurrency(kpis.vgvTotal)}</div><div class="kpi-label">VGV Lancado</div></div><div class="kpi"><div class="kpi-value">${formatCurrency(kpis.vgvVendido)}</div><div class="kpi-label">VGV Vendido</div></div><div class="kpi"><div class="kpi-value">${formatNumber(kpis.totalUnidades)}</div><div class="kpi-label">Unidades</div></div><div class="kpi"><div class="kpi-value">${kpis.count}</div><div class="kpi-label">Empreendimentos</div></div></div><div><h2 style="font-size:18px;margin-bottom:16px;border-bottom:2px solid #A3C6B8;padding-bottom:8px;color:#1A665B">Top Empreendimentos</h2><table><thead><tr><th>#</th><th>Empreendimento</th><th>Cidade</th><th>Incorporadora</th><th>Ano</th><th>VGV Lancado</th><th>VGV Vendido</th></tr></thead><tbody>${rows}</tbody></table></div><div class="footer"><p><strong>Piemonte</strong> - Dados via GeoBrain API - ${formatDateTime(new Date())}</p></div></body></html>`;

  const w = window.open("", "_blank");
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 500);
};

// ─── UI COMPONENTS ────────────────────────────────────────────────────────────

const FilterSection = ({ title, isOpen, onToggle, children, count }) => (
  <div style={{ borderBottom: `1px solid ${COLORS.border}40` }}>
    <button
      onClick={onToggle}
      style={{
        width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 16px", background: "transparent", border: "none", color: COLORS.text,
        cursor: "pointer", fontSize: "12px", fontWeight: "600",
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        {title}
        {count > 0 && (
          <span style={{ background: COLORS.accent, color: "white", fontSize: "8px", padding: "1px 5px", borderRadius: "8px" }}>
            {count}
          </span>
        )}
      </span>
      {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
    </button>
    {isOpen && <div style={{ padding: "0 16px 14px", maxHeight: "200px", overflowY: "auto" }}>{children}</div>}
  </div>
);

const Checkbox = ({ label, checked, onChange }) => (
  <label
    style={{
      display: "flex", alignItems: "center", gap: "8px", padding: "5px 0",
      cursor: "pointer", fontSize: "11px", color: checked ? COLORS.text : COLORS.textMuted,
    }}
  >
    <input type="checkbox" checked={checked} onChange={onChange} style={{ display: "none" }} />
    <div
      style={{
        width: "14px", height: "14px", borderRadius: "3px",
        border: `2px solid ${checked ? COLORS.accent : COLORS.textMuted}`,
        background: checked ? COLORS.accent : "transparent",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}
    >
      {checked && (
        <svg width="8" height="6" viewBox="0 0 10 8" fill="none">
          <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" />
        </svg>
      )}
    </div>
    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
  </label>
);

const RangeFilter = ({ min, max, value, onChange, formatValue }) => (
  <div style={{ padding: "6px 0" }}>
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
      <span style={{ fontSize: "10px", color: COLORS.textMuted }}>{formatValue(value[0])}</span>
      <span style={{ fontSize: "10px", color: COLORS.textMuted }}>{formatValue(value[1])}</span>
    </div>
    <div style={{ display: "flex", gap: "6px" }}>
      <input type="range" min={min} max={max} value={value[0]} onChange={(e) => onChange([Number(e.target.value), value[1]])} style={{ flex: 1, accentColor: COLORS.accent }} />
      <input type="range" min={min} max={max} value={value[1]} onChange={(e) => onChange([value[0], Number(e.target.value)])} style={{ flex: 1, accentColor: COLORS.accent }} />
    </div>
  </div>
);

const KPICard = ({ icon: Icon, title, value, subtitle, color = COLORS.accent }) => (
  <div
    style={{
      background: `linear-gradient(135deg, ${COLORS.card} 0%, rgba(21, 61, 54, 0.9) 100%)`,
      borderRadius: "12px", padding: "18px", border: `1px solid ${COLORS.border}40`,
      position: "relative", overflow: "hidden", boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
    }}
  >
    <div
      style={{
        position: "absolute", top: 0, right: 0, width: "70px", height: "70px",
        background: `radial-gradient(circle at top right, ${color}30, transparent)`, borderRadius: "0 12px 0 70px",
      }}
    />
    <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
      <div
        style={{
          width: "36px", height: "36px", borderRadius: "8px",
          background: `linear-gradient(135deg, ${color}40, ${color}20)`,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <Icon size={18} color={color} />
      </div>
      <div>
        <p style={{ fontSize: "10px", color: COLORS.textMuted, marginBottom: "2px", textTransform: "uppercase", letterSpacing: "0.5px" }}>{title}</p>
        <p style={{ fontSize: "20px", fontWeight: "700", color: COLORS.text, margin: 0 }}>{value}</p>
        {subtitle && <p style={{ fontSize: "10px", color: COLORS.accent, marginTop: "2px" }}>{subtitle}</p>}
      </div>
    </div>
  </div>
);

const ChartCard = ({ title, children, style = {}, action }) => (
  <div
    style={{
      background: `linear-gradient(135deg, ${COLORS.card} 0%, rgba(21, 61, 54, 0.9) 100%)`,
      borderRadius: "12px", padding: "18px", border: `1px solid ${COLORS.border}40`,
      boxShadow: "0 4px 20px rgba(0,0,0,0.15)", ...style,
    }}
  >
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
      <h3 style={{ fontSize: "13px", fontWeight: "600", color: COLORS.text, margin: 0 }}>{title}</h3>
      {action}
    </div>
    {children}
  </div>
);

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: COLORS.primary, border: `1px solid ${COLORS.accent}`, borderRadius: "8px", padding: "10px 12px", boxShadow: "0 4px 12px rgba(0,0,0,0.3)" }}>
      <p style={{ color: COLORS.text, fontWeight: "600", marginBottom: "4px", fontSize: "11px" }}>{label}</p>
      {payload.map((e, i) => (
        <p key={i} style={{ color: e.color, fontSize: "10px", margin: "2px 0" }}>
          {e.name}: {e.value > 1000 ? formatCurrency(e.value) : formatNumber(e.value)}
        </p>
      ))}
    </div>
  );
};

const LoadingScreen = ({ progress }) => (
  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", background: `linear-gradient(180deg, ${COLORS.primary} 0%, #0D2E28 100%)`, color: COLORS.text }}>
    <PiemonteLogo size={80} color={COLORS.accent} />
    <Loader2 size={32} color={COLORS.accent} style={{ animation: "spin 1s linear infinite", marginTop: "24px" }} />
    <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    <h2 style={{ marginTop: "20px", fontSize: "18px", fontWeight: "600" }}>Conectando a API GeoBrain...</h2>
    {progress && (
      <div style={{ marginTop: "16px", width: "300px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
          <span style={{ color: COLORS.textMuted, fontSize: "12px" }}>Carregando empreendimentos</span>
          <span style={{ color: COLORS.accent, fontSize: "12px", fontWeight: "600" }}>{formatNumber(progress.loaded)}</span>
        </div>
        <div style={{ width: "100%", height: "6px", background: "rgba(255,255,255,0.1)", borderRadius: "3px", overflow: "hidden" }}>
          <div style={{ width: `${progress.total ? (progress.loaded / progress.total) * 100 : 50}%`, height: "100%", background: `linear-gradient(90deg, ${COLORS.accent}, ${COLORS.success})`, borderRadius: "3px", transition: "width 0.3s" }} />
        </div>
      </div>
    )}
    <p style={{ color: COLORS.textMuted, fontSize: "13px", marginTop: "16px" }}>Pensado. Construido. Feito pra voce.</p>
  </div>
);

const ErrorScreen = ({ error, onRetry }) => (
  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", background: `linear-gradient(180deg, ${COLORS.primary} 0%, #0D2E28 100%)`, color: COLORS.text }}>
    <PiemonteLogo size={60} color={COLORS.textMuted} />
    <AlertCircle size={48} color={COLORS.danger} style={{ marginTop: "20px" }} />
    <h2 style={{ marginTop: "20px", fontSize: "18px", fontWeight: "600" }}>Erro ao conectar com a API</h2>
    <p style={{ color: COLORS.textMuted, fontSize: "13px", marginTop: "8px", textAlign: "center", maxWidth: "400px" }}>{error}</p>
    <button
      onClick={onRetry}
      style={{
        marginTop: "20px", padding: "10px 24px", borderRadius: "8px",
        background: `linear-gradient(135deg, ${COLORS.accent}, ${COLORS.success})`,
        border: "none", color: "white", cursor: "pointer", fontSize: "14px", fontWeight: "600",
        display: "flex", alignItems: "center", gap: "8px",
      }}
    >
      <RefreshCw size={16} /> Tentar novamente
    </button>
  </div>
);

const ConnectionStatus = ({ isConnected, lastUpdate, dataCount }) => (
  <div style={{ display: "flex", alignItems: "center", gap: "16px", padding: "8px 16px", background: COLORS.primary, borderRadius: "8px", fontSize: "11px", border: `1px solid ${COLORS.border}40` }}>
    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      {isConnected ? <Wifi size={14} color={COLORS.accent} /> : <WifiOff size={14} color={COLORS.danger} />}
      <span style={{ color: isConnected ? COLORS.accent : COLORS.danger }}>{isConnected ? "Conectado" : "Offline"}</span>
    </div>
    {lastUpdate && (
      <div style={{ display: "flex", alignItems: "center", gap: "6px", color: COLORS.textMuted }}>
        <Clock size={12} />
        <span>Atualizado: {formatDateTime(lastUpdate)}</span>
      </div>
    )}
    <div style={{ color: COLORS.text }}>
      <span style={{ fontWeight: "600", color: COLORS.accent }}>{formatNumber(dataCount)}</span> empreendimentos
    </div>
  </div>
);

// ─── DEFAULT FILTER STATE ─────────────────────────────────────────────────────
const DEFAULT_FILTERS = {
  estados: [], cidades: [], bairros: [], padroes: [], status: [], tipos: [],
  tiposImovel: [], quartos: [], anosLancamento: [], incorporadoras: [],
  m2Range: [0, 2000], ticketRange: [0, 100000000], valorM2Range: [0, 100000],
};

const DEFAULT_SECTIONS = {
  anoLancamento: true, estado: true, cidade: false, padrao: true,
  m2: false, status: false, bairro: false, tipo: true, ticket: false,
  valorM2: false, tipoImovel: false, quartos: false, incorporadora: false,
};

// ─── MAIN DASHBOARD ───────────────────────────────────────────────────────────
export default function Dashboard() {
  const [rawData, setRawData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(null);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [isConnected, setIsConnected] = useState(true);

  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [openSections, setOpenSections] = useState(DEFAULT_SECTIONS);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    setLoadingProgress(null);
    try {
      const data = await apiService.fetchCompleteData((progress) => setLoadingProgress(progress));
      setRawData(data);
      setLastUpdate(new Date());
      setIsConnected(true);
    } catch (err) {
      setError(err.message || "Erro ao conectar com a API GeoBrain.");
      setIsConnected(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // ─── Derived data ───────────────────────────────────────────────────────────
  const filterOptions = useMemo(() => ({
    estados: [...new Set(rawData.map((d) => d.estado).filter(Boolean))].sort(),
    cidades: [...new Set(rawData.map((d) => d.cidade).filter(Boolean))].sort(),
    bairros: [...new Set(rawData.map((d) => d.bairro).filter(Boolean))].sort(),
    status: [...new Set(rawData.map((d) => d.status).filter(Boolean))].sort(),
    tipos: [...new Set(rawData.map((d) => d.tipo).filter(Boolean))].sort(),
    padroes: [...new Set(rawData.map((d) => d.padrao).filter(Boolean))].sort(),
    tiposImovel: [...new Set(rawData.map((d) => d.tipoImovel).filter(Boolean))].sort(),
    quartos: [...new Set(rawData.map((d) => d.quartos).filter(Boolean))].sort((a, b) => a - b),
    anosLancamento: [...new Set(rawData.map((d) => d.anoLancamento).filter(Boolean))].sort((a, b) => b - a),
    incorporadoras: [...new Set(rawData.map((d) => d.incorporadora).filter(Boolean))].sort(),
  }), [rawData]);

  const toggleSection = (s) => setOpenSections((p) => ({ ...p, [s]: !p[s] }));
  const toggleFilter = (c, v) => setFilters((p) => ({ ...p, [c]: p[c].includes(v) ? p[c].filter((x) => x !== v) : [...p[c], v] }));
  const clearFilters = () => setFilters(DEFAULT_FILTERS);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    for (const [key, value] of Object.entries(filters)) {
      if (key.includes("Range")) {
        const def = DEFAULT_FILTERS[key];
        if (value[0] !== def[0] || value[1] !== def[1]) count++;
      } else if (Array.isArray(value)) {
        count += value.length;
      }
    }
    return count;
  }, [filters]);

  const filteredData = useMemo(
    () =>
      rawData.filter((i) => {
        if (filters.estados.length && !filters.estados.includes(i.estado)) return false;
        if (filters.cidades.length && !filters.cidades.includes(i.cidade)) return false;
        if (filters.bairros.length && !filters.bairros.includes(i.bairro)) return false;
        if (filters.padroes.length && !filters.padroes.includes(i.padrao)) return false;
        if (filters.status.length && !filters.status.includes(i.status)) return false;
        if (filters.tipos.length && !filters.tipos.includes(i.tipo)) return false;
        if (filters.tiposImovel.length && !filters.tiposImovel.includes(i.tipoImovel)) return false;
        if (filters.quartos.length && !filters.quartos.includes(i.quartos)) return false;
        if (filters.anosLancamento.length && !filters.anosLancamento.includes(i.anoLancamento)) return false;
        if (filters.incorporadoras.length && !filters.incorporadoras.includes(i.incorporadora)) return false;
        if (i.m2 < filters.m2Range[0] || i.m2 > filters.m2Range[1]) return false;
        if (i.preco < filters.ticketRange[0] || i.preco > filters.ticketRange[1]) return false;
        if (i.valorM2 < filters.valorM2Range[0] || i.valorM2 > filters.valorM2Range[1]) return false;
        return true;
      }),
    [rawData, filters]
  );

  const kpis = useMemo(() => {
    const vgvTotal = filteredData.reduce((s, d) => s + (d.vgvTotal || 0), 0);
    const vgvVendido = filteredData.reduce((s, d) => s + (d.vgvVendido || 0), 0);
    const totalUnidades = filteredData.reduce((s, d) => s + (d.totalUnidades || 0), 0);
    const unidadesVendidas = filteredData.reduce((s, d) => s + (d.unidadesVendidas || 0), 0);
    return { vgvTotal, vgvVendido, totalUnidades, unidadesVendidas, count: filteredData.length };
  }, [filteredData]);

  const vgvPorCidade = useMemo(() => {
    const g = {};
    filteredData.forEach((i) => {
      if (!g[i.cidade]) g[i.cidade] = { cidade: i.cidade, vgvTotal: 0, vgvVendido: 0 };
      g[i.cidade].vgvTotal += i.vgvTotal || 0;
      g[i.cidade].vgvVendido += i.vgvVendido || 0;
    });
    return Object.values(g).sort((a, b) => b.vgvTotal - a.vgvTotal).slice(0, 8);
  }, [filteredData]);

  const vgvPorTipo = useMemo(() => {
    const g = {};
    filteredData.forEach((i) => {
      if (!g[i.tipo]) g[i.tipo] = { tipo: i.tipo, vgvTotal: 0 };
      g[i.tipo].vgvTotal += i.vgvTotal || 0;
    });
    return Object.values(g);
  }, [filteredData]);

  const vgvPorPadrao = useMemo(() => {
    const g = {};
    filteredData.forEach((i) => {
      if (!g[i.padrao]) g[i.padrao] = { padrao: i.padrao, vgvTotal: 0, vgvVendido: 0 };
      g[i.padrao].vgvTotal += i.vgvTotal || 0;
      g[i.padrao].vgvVendido += i.vgvVendido || 0;
    });
    return Object.values(g).sort((a, b) => b.vgvTotal - a.vgvTotal).slice(0, 8);
  }, [filteredData]);

  const topEmpreendimentos = useMemo(
    () => [...filteredData].sort((a, b) => (b.vgvTotal || 0) - (a.vgvTotal || 0)).slice(0, 10),
    [filteredData]
  );

  const topIncorporadoras = useMemo(() => {
    const map = {};
    filteredData.forEach((d) => {
      map[d.incorporadora] = (map[d.incorporadora] || 0) + (d.vgvTotal || 0);
    });
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map((d) => d[0]);
  }, [filteredData]);

  const evolucaoIncorporadoras = useMemo(() => {
    const anos = filterOptions.anosLancamento.slice().sort((a, b) => a - b);
    return anos.map((ano) => {
      const row = { ano: ano.toString() };
      topIncorporadoras.forEach((inc) => {
        row[inc] = filteredData
          .filter((d) => d.anoLancamento === ano && d.incorporadora === inc)
          .reduce((s, d) => s + (d.vgvTotal || 0), 0);
      });
      return row;
    });
  }, [filteredData, topIncorporadoras, filterOptions.anosLancamento]);

  const filteredCidades = filterOptions.cidades.filter((c) => c?.toLowerCase().includes(searchTerm.toLowerCase()));
  const filteredBairros = filterOptions.bairros.filter((b) => b?.toLowerCase().includes(searchTerm.toLowerCase()));
  const filteredIncorporadoras = filterOptions.incorporadoras.filter((i) => i?.toLowerCase().includes(searchTerm.toLowerCase()));

  // ─── Loading / Error screens ────────────────────────────────────────────────
  if (loading) return <LoadingScreen progress={loadingProgress} />;
  if (error) return <ErrorScreen error={error} onRetry={fetchData} />;

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", minHeight: "100vh", background: `linear-gradient(180deg, ${COLORS.primary} 0%, #0D2E28 100%)`, fontFamily: "'Inter', -apple-system, sans-serif", color: COLORS.text }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {/* ── Sidebar ────────────────────────────────────────────────────────── */}
      <div
        style={{
          width: sidebarOpen ? "280px" : "0px", minWidth: sidebarOpen ? "280px" : "0px",
          background: COLORS.sidebar, borderRight: `1px solid ${COLORS.border}30`,
          overflow: "hidden", transition: "all 0.3s", display: "flex", flexDirection: "column",
        }}
      >
        <div style={{ padding: "16px", borderBottom: `1px solid ${COLORS.border}30`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Filter size={16} color={COLORS.accent} />
            <span style={{ fontWeight: "600", fontSize: "13px" }}>Filtros</span>
            {activeFilterCount > 0 && (
              <span style={{ background: COLORS.accent, color: "white", fontSize: "9px", padding: "2px 6px", borderRadius: "10px" }}>{activeFilterCount}</span>
            )}
          </div>
          {activeFilterCount > 0 && (
            <button onClick={clearFilters} style={{ background: "transparent", border: "none", color: COLORS.danger, cursor: "pointer", fontSize: "10px", display: "flex", alignItems: "center", gap: "4px" }}>
              <X size={10} /> Limpar
            </button>
          )}
        </div>

        <div style={{ padding: "10px 16px", borderBottom: `1px solid ${COLORS.border}30` }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", background: COLORS.primary, borderRadius: "6px", padding: "6px 10px", border: `1px solid ${COLORS.border}40` }}>
            <Search size={12} color={COLORS.textMuted} />
            <input
              type="text" placeholder="Buscar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
              style={{ flex: 1, background: "transparent", border: "none", color: COLORS.text, fontSize: "11px", outline: "none" }}
            />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          <FilterSection title="Ano de Lancamento" isOpen={openSections.anoLancamento} onToggle={() => toggleSection("anoLancamento")} count={filters.anosLancamento.length}>
            {filterOptions.anosLancamento.map((ano) => <Checkbox key={ano} label={ano?.toString()} checked={filters.anosLancamento.includes(ano)} onChange={() => toggleFilter("anosLancamento", ano)} />)}
          </FilterSection>

          <FilterSection title="Estado" isOpen={openSections.estado} onToggle={() => toggleSection("estado")} count={filters.estados.length}>
            {filterOptions.estados.map((e) => <Checkbox key={e} label={e} checked={filters.estados.includes(e)} onChange={() => toggleFilter("estados", e)} />)}
          </FilterSection>

          <FilterSection title="Cidade" isOpen={openSections.cidade} onToggle={() => toggleSection("cidade")} count={filters.cidades.length}>
            {(searchTerm ? filteredCidades : filterOptions.cidades).slice(0, 50).map((c) => <Checkbox key={c} label={c} checked={filters.cidades.includes(c)} onChange={() => toggleFilter("cidades", c)} />)}
          </FilterSection>

          <FilterSection title="Bairro" isOpen={openSections.bairro} onToggle={() => toggleSection("bairro")} count={filters.bairros.length}>
            {(searchTerm ? filteredBairros : filterOptions.bairros).slice(0, 50).map((b) => <Checkbox key={b} label={b} checked={filters.bairros.includes(b)} onChange={() => toggleFilter("bairros", b)} />)}
          </FilterSection>

          <FilterSection title="Incorporadora" isOpen={openSections.incorporadora} onToggle={() => toggleSection("incorporadora")} count={filters.incorporadoras.length}>
            {(searchTerm ? filteredIncorporadoras : filterOptions.incorporadoras).slice(0, 50).map((i) => <Checkbox key={i} label={i} checked={filters.incorporadoras.includes(i)} onChange={() => toggleFilter("incorporadoras", i)} />)}
          </FilterSection>

          <FilterSection title="Padrao" isOpen={openSections.padrao} onToggle={() => toggleSection("padrao")} count={filters.padroes.length}>
            {filterOptions.padroes.map((p) => <Checkbox key={p} label={p} checked={filters.padroes.includes(p)} onChange={() => toggleFilter("padroes", p)} />)}
          </FilterSection>

          <FilterSection title="Tipo de Empreendimento" isOpen={openSections.tipo} onToggle={() => toggleSection("tipo")} count={filters.tipos.length}>
            {filterOptions.tipos.map((t) => <Checkbox key={t} label={t} checked={filters.tipos.includes(t)} onChange={() => toggleFilter("tipos", t)} />)}
          </FilterSection>

          <FilterSection title="Tipo de Imovel" isOpen={openSections.tipoImovel} onToggle={() => toggleSection("tipoImovel")} count={filters.tiposImovel.length}>
            {filterOptions.tiposImovel.map((t) => <Checkbox key={t} label={t} checked={filters.tiposImovel.includes(t)} onChange={() => toggleFilter("tiposImovel", t)} />)}
          </FilterSection>

          <FilterSection title="Quartos" isOpen={openSections.quartos} onToggle={() => toggleSection("quartos")} count={filters.quartos.length}>
            {filterOptions.quartos.map((q) => <Checkbox key={q} label={`${q} quarto${q > 1 ? "s" : ""}`} checked={filters.quartos.includes(q)} onChange={() => toggleFilter("quartos", q)} />)}
          </FilterSection>

          <FilterSection title="Status" isOpen={openSections.status} onToggle={() => toggleSection("status")} count={filters.status.length}>
            {filterOptions.status.map((s) => <Checkbox key={s} label={s} checked={filters.status.includes(s)} onChange={() => toggleFilter("status", s)} />)}
          </FilterSection>

          <FilterSection title="Metragem (m2)" isOpen={openSections.m2} onToggle={() => toggleSection("m2")}>
            <RangeFilter min={0} max={2000} value={filters.m2Range} onChange={(v) => setFilters((p) => ({ ...p, m2Range: v }))} formatValue={(v) => `${v} m2`} />
          </FilterSection>

          <FilterSection title="Ticket (R$)" isOpen={openSections.ticket} onToggle={() => toggleSection("ticket")}>
            <RangeFilter min={0} max={100000000} value={filters.ticketRange} onChange={(v) => setFilters((p) => ({ ...p, ticketRange: v }))} formatValue={formatCurrency} />
          </FilterSection>

          <FilterSection title="Valor do M2 (R$)" isOpen={openSections.valorM2} onToggle={() => toggleSection("valorM2")}>
            <RangeFilter min={0} max={100000} value={filters.valorM2Range} onChange={(v) => setFilters((p) => ({ ...p, valorM2Range: v }))} formatValue={(v) => `R$ ${formatNumber(v)}`} />
          </FilterSection>
        </div>
      </div>

      {/* ── Main Content ───────────────────────────────────────────────────── */}
      <div style={{ flex: 1, padding: "20px", overflowY: "auto" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px", flexWrap: "wrap", gap: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              style={{
                width: "36px", height: "36px", borderRadius: "8px", background: COLORS.sidebar,
                border: `1px solid ${COLORS.border}40`, color: COLORS.text, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <SlidersHorizontal size={16} />
            </button>
            <div>
              <h1 style={{ fontSize: "20px", fontWeight: "700", margin: 0, display: "flex", alignItems: "center", gap: "10px" }}>
                <PiemonteLogo size={32} color={COLORS.accent} />
                <span>piemonte</span>
                <span style={{ fontSize: "12px", fontWeight: "400", color: COLORS.textMuted, marginLeft: "8px" }}>Dashboard Mercado Imobiliario</span>
              </h1>
              <p style={{ color: COLORS.textMuted, margin: 0, fontSize: "11px", marginTop: "2px" }}>
                Pensado. Construido. Feito pra voce. - Dados em tempo real via GeoBrain API
              </p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
            <ConnectionStatus isConnected={isConnected} lastUpdate={lastUpdate} dataCount={rawData.length} />
            <button
              onClick={fetchData} disabled={loading}
              style={{
                display: "flex", alignItems: "center", gap: "6px", padding: "8px 12px", borderRadius: "8px",
                background: COLORS.sidebar, border: `1px solid ${COLORS.border}40`, color: COLORS.text,
                cursor: loading ? "not-allowed" : "pointer", fontSize: "12px", opacity: loading ? 0.7 : 1,
              }}
            >
              <RefreshCw size={14} /> Atualizar
            </button>
            <button
              onClick={() => generatePDF(filteredData, kpis)}
              style={{
                display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px", borderRadius: "8px",
                background: `linear-gradient(135deg, ${COLORS.accent}, ${COLORS.success})`,
                border: "none", color: "white", cursor: "pointer", fontSize: "12px", fontWeight: "600",
              }}
            >
              <Download size={14} /> Baixar PDF
            </button>
          </div>
        </div>

        {/* KPIs */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "14px", marginBottom: "20px" }}>
          <KPICard icon={DollarSign} title="VGV Lancado" value={formatCurrency(kpis.vgvTotal)} color={COLORS.accent} />
          <KPICard icon={TrendingUp} title="VGV Vendido" value={formatCurrency(kpis.vgvVendido)} subtitle={kpis.vgvTotal > 0 ? `${((kpis.vgvVendido / kpis.vgvTotal) * 100).toFixed(1)}% do lancado` : ""} color={COLORS.success} />
          <KPICard icon={Home} title="Unidades Lancadas" value={formatNumber(kpis.totalUnidades)} subtitle={`${formatNumber(kpis.unidadesVendidas)} vendidas`} color="#5CAA8A" />
          <KPICard icon={MapPin} title="Empreendimentos" value={formatNumber(kpis.count)} color="#A3C6B8" />
        </div>

        {/* Charts Row 1 */}
        <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: "14px", marginBottom: "14px" }}>
          <ChartCard title="VGV por Cidade (Top 8)">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={vgvPorCidade} layout="vertical" margin={{ left: 80 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={`${COLORS.border}40`} vertical={false} />
                <XAxis type="number" stroke={COLORS.textMuted} fontSize={9} tickFormatter={formatCurrency} />
                <YAxis type="category" dataKey="cidade" stroke={COLORS.textMuted} fontSize={9} width={75} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="vgvTotal" name="VGV Total" fill="url(#gradientBarPiemonte)" radius={[0, 4, 4, 0]} />
                <Bar dataKey="vgvVendido" name="VGV Vendido" fill={COLORS.success} radius={[0, 4, 4, 0]} />
                <defs>
                  <linearGradient id="gradientBarPiemonte" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor={COLORS.accent} />
                    <stop offset="100%" stopColor={COLORS.success} />
                  </linearGradient>
                </defs>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="VGV por Tipo">
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={vgvPorTipo} cx="50%" cy="50%" innerRadius={55} outerRadius={85}
                  paddingAngle={3} dataKey="vgvTotal" nameKey="tipo"
                  label={({ tipo, percent }) => `${tipo} ${(percent * 100).toFixed(0)}%`}
                  labelLine={{ stroke: COLORS.textMuted }}
                >
                  {vgvPorTipo.map((_, i) => <Cell key={`cell-${i}`} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        {/* Evolution Chart */}
        <ChartCard title="Evolucao Anual das Top Incorporadoras (VGV Lancado)" style={{ marginBottom: "14px" }} action={<Calendar size={14} color={COLORS.textMuted} />}>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={evolucaoIncorporadoras} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <defs>
                {topIncorporadoras.map((inc, i) => (
                  <linearGradient key={inc} id={`gradient-piemonte-${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={LINE_COLORS[i % LINE_COLORS.length]} stopOpacity={0.4} />
                    <stop offset="95%" stopColor={LINE_COLORS[i % LINE_COLORS.length]} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={`${COLORS.border}40`} vertical={false} />
              <XAxis dataKey="ano" stroke={COLORS.textMuted} fontSize={10} />
              <YAxis stroke={COLORS.textMuted} fontSize={9} tickFormatter={formatCurrency} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: "10px", paddingTop: "10px" }} />
              {topIncorporadoras.map((inc, i) => (
                <Area key={inc} type="monotone" dataKey={inc} name={inc} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2} fill={`url(#gradient-piemonte-${i})`} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* VGV por Padrao */}
        <ChartCard title="VGV por Padrao" style={{ marginBottom: "14px" }}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={vgvPorPadrao} margin={{ bottom: 50 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={`${COLORS.border}40`} vertical={false} />
              <XAxis dataKey="padrao" stroke={COLORS.textMuted} fontSize={8} angle={-35} textAnchor="end" height={60} interval={0} />
              <YAxis stroke={COLORS.textMuted} fontSize={9} tickFormatter={formatCurrency} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ paddingTop: "15px", fontSize: "10px" }} />
              <Bar dataKey="vgvTotal" name="VGV Lancado" fill={COLORS.accent} radius={[4, 4, 0, 0]} />
              <Bar dataKey="vgvVendido" name="VGV Vendido" fill={COLORS.success} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Top Empreendimentos Table */}
        <ChartCard title="Top 10 Empreendimentos por VGV Lancado">
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${COLORS.border}40` }}>
                  {["Empreendimento", "Cidade", "Ano", "Padrao", "VGV Lancado", "VGV Vendido", "Vendas"].map((h, i) => (
                    <th key={h} style={{ padding: "8px 10px", textAlign: i >= 4 ? "right" : i === 2 ? "center" : "left", color: COLORS.textMuted, fontWeight: "500" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {topEmpreendimentos.map((emp, i) => (
                  <tr key={emp.id} style={{ borderBottom: `1px solid ${COLORS.border}30`, background: i % 2 === 0 ? "transparent" : "rgba(0,184,113,0.03)" }}>
                    <td style={{ padding: "10px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span
                          style={{
                            width: "20px", height: "20px", borderRadius: "5px",
                            background: `linear-gradient(135deg, ${CHART_COLORS[i % CHART_COLORS.length]}50, ${CHART_COLORS[i % CHART_COLORS.length]}30)`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: "9px", fontWeight: "600", color: CHART_COLORS[i % CHART_COLORS.length], flexShrink: 0,
                          }}
                        >
                          {i + 1}
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <span style={{ fontWeight: "500", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{emp.nome}</span>
                          <div style={{ fontSize: "9px", color: COLORS.textMuted }}>{emp.incorporadora}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: "10px", color: COLORS.textMuted }}>{emp.cidade}/{emp.estado}</td>
                    <td style={{ padding: "10px", textAlign: "center" }}>
                      <span style={{ padding: "2px 8px", borderRadius: "4px", fontSize: "9px", fontWeight: "600", background: `${COLORS.accent}30`, color: COLORS.accent }}>{emp.anoLancamento}</span>
                    </td>
                    <td style={{ padding: "10px" }}>
                      <span style={{ padding: "2px 6px", borderRadius: "4px", fontSize: "9px", fontWeight: "500", background: `${COLORS.accent}25`, color: COLORS.accent }}>{emp.padrao}</span>
                    </td>
                    <td style={{ padding: "10px", textAlign: "right", fontWeight: "600" }}>{formatCurrency(emp.vgvTotal)}</td>
                    <td style={{ padding: "10px", textAlign: "right", color: COLORS.accent }}>{formatCurrency(emp.vgvVendido)}</td>
                    <td style={{ padding: "10px", textAlign: "center", color: COLORS.textMuted }}>{emp.unidadesVendidas}/{emp.totalUnidades}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartCard>

        {/* Footer */}
        <div style={{ marginTop: "20px", textAlign: "center", color: COLORS.textMuted, fontSize: "10px", padding: "14px", borderTop: `1px solid ${COLORS.border}30` }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", marginBottom: "4px" }}>
            <PiemonteLogo size={20} color={COLORS.accent} />
            <span style={{ fontWeight: "600", color: COLORS.text }}>piemonte</span>
            <span>- Pensado. Construido. Feito pra voce.</span>
          </div>
          <p>Dados em tempo real via GeoBrain API - {formatNumber(rawData.length)} empreendimentos carregados</p>
          {lastUpdate && <p style={{ marginTop: "4px" }}>Ultima atualizacao: {formatDateTime(lastUpdate)}</p>}
        </div>
      </div>
    </div>
  );
}
