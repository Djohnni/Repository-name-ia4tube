# -*- coding: utf-8 -*-
"""
IA4Tube Analytics - Programa local leve.
Le os pedidos em: C:\\Users\\USER\\Desktop\\resultado\\IA4tube\\Pedidos
Abre com duplo clique e fecha no X.
"""

import json
import os
from pathlib import Path
from datetime import datetime, timedelta, timezone
from collections import Counter, defaultdict
import tkinter as tk
from tkinter import ttk, messagebox
import urllib.request
import urllib.error

try:
    from matplotlib.figure import Figure
    from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
except Exception:
    Figure = None
    FigureCanvasTkAgg = None

BASE_DIR = Path(r"C:\Users\USER\Desktop\resultado\IA4tube")
PEDIDOS_DIR = BASE_DIR / "Pedidos"
SUPORTE_DIR = BASE_DIR / "Suporte"
CONFIG_FILE = BASE_DIR / "analytics_config.json"
IGNORADOS_FILE = BASE_DIR / "clientes_ignorados.json"
ANALYTICS_ONLINE_DIR = BASE_DIR / "AnalyticsOnline"

DEFAULT_CONFIG = {
    "produtos": {
        "resultado": {"nome": "Resultado do jogo", "valor": 8.0},
        "escalacao": {"nome": "Escalação", "valor": 8.0},
        "contratacao": {"nome": "Contratação", "valor": 8.0},
        "proximo_jogo": {"nome": "Próximo jogo", "valor": 8.0},
        "patrocinador": {"nome": "Patrocinador / Apoio", "valor": 8.0},
        "escudo3d": {"nome": "Escudo 3D", "valor": 18.0},
        "proximo_jogo_jogador": {"nome": "Próximo jogo jogador", "valor": 8.0},
        "resultado_jogo_jogador": {"nome": "Resultado jogador", "valor": 8.0},
        "jogador_escudo": {"nome": "Jogador + escudo", "valor": 8.0},
        "desconhecido": {"nome": "Desconhecido", "valor": 0.0}
    },
    "online": {
        "api_url": "https://api.omascote.com.br",
        "token": ""
    }
}

BR_TZ = timezone(timedelta(hours=-3))


def ensure_config():
    if not CONFIG_FILE.exists():
        CONFIG_FILE.write_text(json.dumps(DEFAULT_CONFIG, ensure_ascii=False, indent=2), encoding="utf-8")
    try:
        data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    except Exception:
        data = dict(DEFAULT_CONFIG)
    if "produtos" not in data:
        data["produtos"] = DEFAULT_CONFIG["produtos"]
    for k, v in DEFAULT_CONFIG["produtos"].items():
        data["produtos"].setdefault(k, v)

    if "online" not in data:
        data["online"] = DEFAULT_CONFIG["online"]
    data["online"].setdefault("api_url", DEFAULT_CONFIG["online"]["api_url"])
    data["online"].setdefault("token", "")

    return data


def save_config(config):
    CONFIG_FILE.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")

def carregar_ignorados():
    if not IGNORADOS_FILE.exists():
        return set()
    try:
        return set(json.loads(IGNORADOS_FILE.read_text(encoding="utf-8")))
    except Exception:
        return set()

def salvar_ignorados(lista):
    IGNORADOS_FILE.write_text(json.dumps(list(lista), ensure_ascii=False, indent=2), encoding="utf-8")


def parse_dt(value, fallback_id=""):
    if value:
        try:
            s = str(value).replace("Z", "+00:00")
            d = datetime.fromisoformat(s)
            if d.tzinfo is None:
                d = d.replace(tzinfo=timezone.utc)
            return d.astimezone(BR_TZ)
        except Exception:
            pass
    try:
        d = datetime.strptime(str(fallback_id), "%Y%m%d_%H%M%S")
        return d.replace(tzinfo=BR_TZ)
    except Exception:
        return None


def normalizar_categoria(pedido, pedido_dir):
    cat = str(pedido.get("categoria") or "").strip().lower()
    if cat:
        return cat

    tipo_path = pedido_dir / "tipo.txt"
    if tipo_path.exists():
        try:
            tipo = tipo_path.read_text(encoding="utf-8", errors="ignore").strip().lower()
            if tipo:
                return tipo
        except Exception:
            pass

    flyer_tipo = str(pedido.get("flyer_tipo") or "").strip().lower()
    mapa = {
        "zz1fs": "escalacao",
        "zz1fm": "contratacao",
        "zz1ft": "proximo_jogo",
        "zz1fj": "patrocinador",
        "escudo3d": "escudo3d",
        "jog_proximo": "proximo_jogo_jogador",
        "jog_resultado": "resultado_jogo_jogador",
        "jog_escudo": "jogador_escudo"
    }
    return mapa.get(flyer_tipo, "desconhecido")


def ler_status(pedido, pedido_dir):
    status = str(pedido.get("status") or "").strip().lower()
    status_path = pedido_dir / "status.txt"
    if status_path.exists():
        try:
            s = status_path.read_text(encoding="utf-8", errors="ignore").strip().lower()
            if s:
                status = s
        except Exception:
            pass
    if (pedido_dir / "resultado_final.png").exists() and status in ("", "novo", "processando"):
        return "pronto"
    return status or "desconhecido"


def carregar_pedidos():
    pedidos = []
    if not PEDIDOS_DIR.exists():
        return pedidos

    for json_path in PEDIDOS_DIR.rglob("pedido.json"):
        pedido_dir = json_path.parent
        try:
            pedido = json.loads(json_path.read_text(encoding="utf-8", errors="ignore"))
        except Exception:
            continue

        pedido_id = str(pedido.get("id") or pedido_dir.name)
        dt = parse_dt(pedido.get("criado_em"), pedido_id)
        if not dt:
            continue

        whatsapp = str(pedido.get("whatsapp") or "sem_whatsapp").strip() or "sem_whatsapp"
        categoria = normalizar_categoria(pedido, pedido_dir)
        status = ler_status(pedido, pedido_dir)

        pedidos.append({
            "id": pedido_id,
            "dt": dt,
            "hora": dt.hour,
            "whatsapp": whatsapp,
            "categoria": categoria,
            "status": status,
            "pasta": str(pedido_dir)
        })

    pedidos.sort(key=lambda x: x["dt"], reverse=True)
    return pedidos


def filtrar_pedidos(pedidos, filtro):
    agora = datetime.now(BR_TZ)
    if filtro == "Hoje":
        return [p for p in pedidos if p["dt"].date() == agora.date()]
    if filtro == "Últimos 2 dias":
        return [p for p in pedidos if p["dt"] >= agora - timedelta(days=2)]
    if filtro == "Últimos 7 dias":
        return [p for p in pedidos if p["dt"] >= agora - timedelta(days=7)]
    if filtro == "Últimos 30 dias":
        return [p for p in pedidos if p["dt"] >= agora - timedelta(days=30)]
    return pedidos


def dinheiro(v):
    return f"R$ {v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def ler_erros_pedidos():
    erros = []
    if not PEDIDOS_DIR.exists():
        return erros

    for erro_path in PEDIDOS_DIR.rglob("erro_*"):
        if not erro_path.is_file():
            continue

        pedido_dir = erro_path.parent
        pedido_json = pedido_dir / "pedido.json"
        pedido = {}

        if pedido_json.exists():
            try:
                pedido = json.loads(pedido_json.read_text(encoding="utf-8", errors="ignore"))
            except Exception:
                pedido = {}

        pedido_id = str(pedido.get("id") or pedido_dir.name)
        dt = parse_dt(pedido.get("criado_em"), pedido_id)

        if not dt:
            try:
                ts = erro_path.stat().st_mtime
                dt = datetime.fromtimestamp(ts, BR_TZ)
            except Exception:
                dt = datetime.now(BR_TZ)

        try:
            texto = erro_path.read_text(encoding="utf-8", errors="ignore").strip()
        except Exception:
            texto = ""

        erros.append({
            "dt": dt,
            "id": pedido_id,
            "cliente": str(pedido.get("whatsapp") or "sem_whatsapp"),
            "produto": normalizar_categoria(pedido, pedido_dir),
            "arquivo": erro_path.name,
            "erro": texto[:220].replace("\n", " "),
            "pasta": str(pedido_dir)
        })

    erros.sort(key=lambda x: x["dt"], reverse=True)
    return erros


def ler_suporte():
    itens = []
    if not SUPORTE_DIR.exists():
        return itens

    for suporte_path in SUPORTE_DIR.glob("*.json"):
        try:
            data = json.loads(suporte_path.read_text(encoding="utf-8", errors="ignore"))
        except Exception:
            data = {}

        dt = parse_dt(data.get("criado_em") or data.get("data") or data.get("created_at"), suporte_path.stem.replace("suporte_", ""))

        if not dt:
            try:
                ts = suporte_path.stat().st_mtime
                dt = datetime.fromtimestamp(ts, BR_TZ)
            except Exception:
                dt = datetime.now(BR_TZ)

        cliente = str(data.get("whatsapp") or data.get("cliente") or data.get("telefone") or "sem_whatsapp")
        status = str(data.get("status") or data.get("situacao") or "suporte")

        resumo = ""
        if isinstance(data.get("mensagens"), list) and data["mensagens"]:
            ultima = data["mensagens"][-1]
            if isinstance(ultima, dict):
                resumo = str(ultima.get("texto") or ultima.get("mensagem") or ultima.get("content") or "")
            else:
                resumo = str(ultima)
        else:
            resumo = str(data.get("mensagem") or data.get("resumo") or data.get("texto") or "")

        itens.append({
            "dt": dt,
            "cliente": cliente,
            "status": status,
            "arquivo": suporte_path.name,
            "resumo": resumo[:220].replace("\n", " "),
            "pasta": str(suporte_path.parent),
            "arquivo_path": str(suporte_path)
        })

    itens.sort(key=lambda x: x["dt"], reverse=True)
    return itens


class AnalyticsApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("IA4Tube Analytics")
        self.geometry("1180x760")
        self.minsize(980, 650)

        self.config_data = ensure_config()
        self.todos_pedidos = []
        self.pedidos = []
        self.todos_erros = []
        self.erros = []
        self.todos_suportes = []
        self.suportes = []

        self.filtro_var = tk.StringVar(value="Últimos 30 dias")
        self.ordenar_clientes_var = tk.StringVar(value="Pedidos")
        hoje_str = datetime.now(BR_TZ).strftime("%Y-%m-%d")

        self.online_data_var = tk.StringVar(value=hoje_str)
        self.online_ate_var = tk.StringVar(value=hoje_str)

        self.online_api_var = tk.StringVar(value="")
        self.online_token_var = tk.StringVar(value="")
        self.online_status_var = tk.StringVar(value="Nenhum download ainda.")
        self.ignorados = carregar_ignorados()

        self.build_ui()
        self.atualizar()

    def build_ui(self):
        style = ttk.Style(self)
        try:
            style.theme_use("clam")
        except Exception:
            pass

        top = ttk.Frame(self, padding=12)
        top.pack(fill="x")
        ttk.Label(top, text="📊 IA4Tube Analytics", font=("Segoe UI", 18, "bold")).pack(side="left")

        filtro_box = ttk.Frame(top)
        filtro_box.pack(side="right")
        ttk.Label(filtro_box, text="Período:").pack(side="left", padx=(0, 5))
        cb = ttk.Combobox(
            filtro_box,
            textvariable=self.filtro_var,
            state="readonly",
            width=18,
            values=["Hoje", "Últimos 2 dias", "Últimos 7 dias", "Últimos 30 dias", "Todo período"]
        )
        cb.pack(side="left", padx=4)
        cb.bind("<<ComboboxSelected>>", lambda e: self.aplicar_filtro())
        ttk.Button(filtro_box, text="Atualizar", command=self.atualizar).pack(side="left", padx=4)
        ttk.Button(filtro_box, text="Valores dos produtos", command=self.abrir_config_valores).pack(side="left", padx=4)

        resumo = ttk.Frame(self, padding=(12, 0, 12, 8))
        resumo.pack(fill="x")
        self.cards = {}
        for key, title in [
            ("total", "Total de pedidos"),
            ("valor", "Faturamento estimado"),
            ("melhor_hora", "Melhor horário"),
            ("cliente_top", "Cliente mais ativo"),
            ("produto_top", "Produto mais pedido"),
        ]:
            frame = ttk.LabelFrame(resumo, text=title, padding=10)
            frame.pack(side="left", fill="x", expand=True, padx=4)
            lbl = ttk.Label(frame, text="—", font=("Segoe UI", 13, "bold"))
            lbl.pack(anchor="center")
            self.cards[key] = lbl

        panes = ttk.PanedWindow(self, orient="horizontal")
        panes.pack(fill="both", expand=True, padx=12, pady=8)
        left = ttk.Frame(panes)
        right = ttk.Frame(panes)
        panes.add(left, weight=3)
        panes.add(right, weight=2)

        graph_frame = ttk.LabelFrame(left, text="Pedidos por horário", padding=8)
        graph_frame.pack(fill="both", expand=True)
        self.graph_holder = ttk.Frame(graph_frame)
        self.graph_holder.pack(fill="both", expand=True)

        tabs = ttk.Notebook(right)
        tabs.pack(fill="both", expand=True)
        self.tab_clientes = ttk.Frame(tabs, padding=8)
        self.tab_produtos = ttk.Frame(tabs, padding=8)
        self.tab_status = ttk.Frame(tabs, padding=8)
        self.tab_pedidos = ttk.Frame(tabs, padding=8)
        self.tab_erros = ttk.Frame(tabs, padding=8)
        self.tab_suporte = ttk.Frame(tabs, padding=8)
        self.tab_online = ttk.Frame(tabs, padding=8)
        tabs.add(self.tab_clientes, text="Clientes")
        tabs.add(self.tab_produtos, text="Produtos")
        tabs.add(self.tab_status, text="Status")
        tabs.add(self.tab_pedidos, text="Pedidos")
        tabs.add(self.tab_erros, text="Erros")
        tabs.add(self.tab_suporte, text="Suporte")
        tabs.add(self.tab_online, text="Analytics Online")

        self.build_clientes_tab()
        self.build_online_tab()
        self.tree_produtos = self.build_tree(self.tab_produtos, ("produto", "pedidos", "valor"), ("Produto", "Pedidos", "Valor"), (170, 70, 90))
        self.tree_status = self.build_tree(self.tab_status, ("status", "pedidos"), ("Status", "Pedidos"), (160, 90))
        self.tree_pedidos = self.build_tree(self.tab_pedidos, ("data", "hora", "cliente", "produto", "status"), ("Data", "Hora", "Cliente", "Produto", "Status"), (90, 55, 120, 125, 80))
        self.tree_erros = self.build_tree(self.tab_erros, ("data", "hora", "id", "cliente", "produto", "arquivo", "erro", "pasta"), ("Data", "Hora", "Pedido", "Cliente", "Produto", "Arquivo", "Erro", "Pasta"), (85, 50, 125, 115, 120, 120, 220, 260))
        self.tree_suporte = self.build_tree(self.tab_suporte, ("data", "hora", "cliente", "status", "arquivo", "resumo", "pasta"), ("Data", "Hora", "Cliente", "Status", "Arquivo", "Resumo", "Pasta"), (85, 50, 115, 80, 150, 260, 260))

        self.tree_erros.bind("<Double-1>", self.abrir_pasta_erro)
        self.tree_suporte.bind("<Double-1>", self.abrir_arquivo_suporte)

        bottom = ttk.Frame(self, padding=(12, 0, 12, 10))
        bottom.pack(fill="x")
        self.footer = ttk.Label(bottom, text=f"Pasta: {PEDIDOS_DIR}")
        self.footer.pack(anchor="w")

    def build_clientes_tab(self):
        controls = ttk.Frame(self.tab_clientes)
        controls.pack(fill="x", pady=(0, 6))
        ttk.Label(controls, text="Ordenar por:").pack(side="left")
        cb = ttk.Combobox(controls, textvariable=self.ordenar_clientes_var, state="readonly", width=12, values=["Pedidos", "Valor"])
        cb.pack(side="left", padx=5)
        cb.bind("<<ComboboxSelected>>", lambda e: self.render())
        self.tree_clientes = self.build_tree(self.tab_clientes, ("cliente", "pedidos", "valor"), ("Cliente/WhatsApp", "Pedidos", "Valor"), (165, 70, 90))
        ttk.Button(controls, text="Ignorar selecionado", command=self.toggle_ignorado).pack(side="left", padx=6)

    def build_tree(self, parent, columns, headings, widths):
        box = ttk.Frame(parent)
        box.pack(fill="both", expand=True)
        tree = ttk.Treeview(box, columns=columns, show="headings")
        for col, head in zip(columns, headings):
            tree.heading(col, text=head)
        for col, width in zip(columns, widths):
            tree.column(col, width=width, anchor="w")
        scroll = ttk.Scrollbar(box, orient="vertical", command=tree.yview)
        tree.configure(yscrollcommand=scroll.set)
        tree.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")
        return tree

    def produto_nome(self, categoria):
        return self.config_data.get("produtos", {}).get(categoria, {}).get("nome", categoria)

    def produto_valor(self, categoria):
        try:
            return float(self.config_data.get("produtos", {}).get(categoria, {}).get("valor", 0) or 0)
        except Exception:
            return 0.0

    def atualizar(self):
        self.config_data = ensure_config()
        self.online_api_var.set(self.config_data.get("online", {}).get("api_url", "https://api.omascote.com.br"))
        self.online_token_var.set(self.config_data.get("online", {}).get("token", ""))
        self.todos_pedidos = carregar_pedidos()
        self.todos_erros = ler_erros_pedidos()
        self.todos_suportes = ler_suporte()
        self.aplicar_filtro()

    def aplicar_filtro(self):
        pedidos_filtrados = filtrar_pedidos(self.todos_pedidos, self.filtro_var.get())
        erros_filtrados = filtrar_pedidos(self.todos_erros, self.filtro_var.get())
        suportes_filtrados = filtrar_pedidos(self.todos_suportes, self.filtro_var.get())

        self.pedidos = [p for p in pedidos_filtrados if p["whatsapp"] not in self.ignorados]
        self.erros = [e for e in erros_filtrados if e["cliente"] not in self.ignorados]
        self.suportes = [s for s in suportes_filtrados if s["cliente"] not in self.ignorados]

        self.render()

    def render(self):
        self.render_resumo()
        self.render_grafico()
        self.render_clientes()
        self.render_produtos()
        self.render_status()
        self.render_pedidos()
        self.render_erros()
        self.render_suporte()
        self.render_online_baixados()
        self.footer.config(text=f"Pasta: {PEDIDOS_DIR}  |  Pedidos lidos: {len(self.todos_pedidos)}  |  Erros: {len(self.erros)}  |  Suporte: {len(self.suportes)}")

    def render_resumo(self):
        total = len(self.pedidos)
        valor_total = sum(self.produto_valor(p["categoria"]) for p in self.pedidos)
        por_hora = Counter(p["hora"] for p in self.pedidos)
        melhor_hora = por_hora.most_common(1)[0] if por_hora else None
        por_cliente = Counter(p["whatsapp"] for p in self.pedidos)
        cliente_top = por_cliente.most_common(1)[0] if por_cliente else None
        por_produto = Counter(p["categoria"] for p in self.pedidos)
        produto_top = por_produto.most_common(1)[0] if por_produto else None

        self.cards["total"].config(text=str(total))
        self.cards["valor"].config(text=dinheiro(valor_total))
        self.cards["melhor_hora"].config(text=f"{melhor_hora[0]:02d}h ({melhor_hora[1]})" if melhor_hora else "—")
        self.cards["cliente_top"].config(text=f"{cliente_top[0]} ({cliente_top[1]})" if cliente_top else "—")
        self.cards["produto_top"].config(text=f"{self.produto_nome(produto_top[0])} ({produto_top[1]})" if produto_top else "—")

    def render_grafico(self):
        for w in self.graph_holder.winfo_children():
            w.destroy()
        horas = list(range(24))
        valores = [0] * 24
        for p in self.pedidos:
            valores[p["hora"]] += 1

        if Figure is None or FigureCanvasTkAgg is None:
            txt = tk.Text(self.graph_holder, height=20)
            txt.pack(fill="both", expand=True)
            for h, v in zip(horas, valores):
                txt.insert("end", f"{h:02d}h | " + "█" * min(v, 60) + f" {v}\n")
            txt.configure(state="disabled")
            return

        fig = Figure(figsize=(7, 4), dpi=100)
        ax = fig.add_subplot(111)
        ax.bar([f"{h:02d}h" for h in horas], valores)
        ax.set_title("Pedidos por hora do dia")
        ax.set_xlabel("Hora")
        ax.set_ylabel("Pedidos")
        ax.tick_params(axis="x", rotation=45)
        fig.tight_layout()
        canvas = FigureCanvasTkAgg(fig, master=self.graph_holder)
        canvas.draw()
        canvas.get_tk_widget().pack(fill="both", expand=True)

    def limpar_tree(self, tree):
        for item in tree.get_children():
            tree.delete(item)

    def render_clientes(self):
        self.limpar_tree(self.tree_clientes)
        stats = defaultdict(lambda: {"pedidos": 0, "valor": 0.0})

        for p in self.pedidos:
            stats[p["whatsapp"]]["pedidos"] += 1
            stats[p["whatsapp"]]["valor"] += self.produto_valor(p["categoria"])

        ordenar = self.ordenar_clientes_var.get()
        items = sorted(stats.items(), key=lambda kv: kv[1]["valor"] if ordenar == "Valor" else kv[1]["pedidos"], reverse=True)

        for cliente, s in items[:300]:
            self.tree_clientes.insert("", "end", values=(cliente, s["pedidos"], dinheiro(s["valor"])))

    def render_produtos(self):
        self.limpar_tree(self.tree_produtos)
        stats = defaultdict(lambda: {"pedidos": 0, "valor": 0.0})
        for p in self.pedidos:
            cat = p["categoria"]
            stats[cat]["pedidos"] += 1
            stats[cat]["valor"] += self.produto_valor(cat)
        for cat, s in sorted(stats.items(), key=lambda kv: kv[1]["pedidos"], reverse=True):
            self.tree_produtos.insert("", "end", values=(self.produto_nome(cat), s["pedidos"], dinheiro(s["valor"])))

    def render_status(self):
        self.limpar_tree(self.tree_status)
        for status, qtd in Counter(p["status"] for p in self.pedidos).most_common():
            self.tree_status.insert("", "end", values=(status, qtd))

    def render_pedidos(self):
        self.limpar_tree(self.tree_pedidos)
        for p in self.pedidos[:700]:
            self.tree_pedidos.insert("", "end", values=(p["dt"].strftime("%d/%m/%Y"), p["dt"].strftime("%H:%M"), p["whatsapp"], self.produto_nome(p["categoria"]), p["status"]))

    def render_erros(self):
        self.limpar_tree(self.tree_erros)
        for e in self.erros[:700]:
            self.tree_erros.insert("", "end", values=(
                e["dt"].strftime("%d/%m/%Y"),
                e["dt"].strftime("%H:%M"),
                e["id"],
                e["cliente"],
                self.produto_nome(e["produto"]),
                e["arquivo"],
                e["erro"],
                e["pasta"]
            ))

    def render_suporte(self):
        self.limpar_tree(self.tree_suporte)
        for s in self.suportes[:700]:
            self.tree_suporte.insert("", "end", values=(
                s["dt"].strftime("%d/%m/%Y"),
                s["dt"].strftime("%H:%M"),
                s["cliente"],
                s["status"],
                s["arquivo"],
                s["resumo"],
                s["pasta"]
            ))

    def abrir_pasta_erro(self, event=None):
        selected = self.tree_erros.selection()
        if not selected:
            return
        item = selected[0]
        values = self.tree_erros.item(item)["values"]
        if not values or len(values) < 8:
            return
        pasta = str(values[7])
        if os.path.exists(pasta):
            os.startfile(pasta)

    def abrir_arquivo_suporte(self, event=None):
        selected = self.tree_suporte.selection()
        if not selected:
            return
        item = selected[0]
        values = self.tree_suporte.item(item)["values"]
        if not values or len(values) < 5:
            return
        arquivo = str(values[4])
        caminho = SUPORTE_DIR / arquivo
        if caminho.exists():
            os.startfile(str(caminho))

    def build_online_tab(self):
        top = ttk.LabelFrame(self.tab_online, text="Baixar analytics do Render", padding=10)
        top.pack(fill="x", pady=(0, 10))

        ttk.Label(top, text="API:").grid(row=0, column=0, sticky="w", padx=4, pady=4)
        ttk.Entry(top, textvariable=self.online_api_var, width=34).grid(row=0, column=1, sticky="ew", padx=4, pady=4)

        ttk.Label(top, text="Token admin:").grid(row=1, column=0, sticky="w", padx=4, pady=4)
        ttk.Entry(top, textvariable=self.online_token_var, width=34, show="*").grid(row=1, column=1, sticky="ew", padx=4, pady=4)

        ttk.Label(top, text="De:").grid(row=2, column=0, sticky="w", padx=4, pady=4)

        periodo = ttk.Frame(top)
        periodo.grid(row=2, column=1, sticky="w", padx=4, pady=4)

        ttk.Entry(periodo, textvariable=self.online_data_var, width=14).pack(side="left")

        ttk.Label(periodo, text="Até:").pack(side="left", padx=(10, 4))

        ttk.Entry(periodo, textvariable=self.online_ate_var, width=14).pack(side="left")

        botoes = ttk.Frame(top)
        botoes.grid(row=3, column=0, columnspan=2, sticky="w", pady=(8, 0))

        ttk.Button(botoes, text="Salvar configuração", command=self.salvar_config_online).pack(side="left", padx=(0, 6))
        ttk.Button(botoes, text="Baixar período", command=self.baixar_analytics_online).pack(side="left", padx=6)
        ttk.Button(botoes, text="Abrir pasta", command=self.abrir_pasta_online).pack(side="left", padx=6)

        top.columnconfigure(1, weight=1)

        ttk.Label(self.tab_online, textvariable=self.online_status_var).pack(anchor="w", pady=(0, 8))

        self.tree_online = self.build_tree(
            self.tab_online,
            ("arquivo", "tamanho", "modificado"),
            ("Arquivo baixado", "Tamanho", "Modificado"),
            (210, 90, 140)
        )

    def salvar_config_online(self):
        self.config_data = ensure_config()
        self.config_data["online"] = {
            "api_url": self.online_api_var.get().strip() or "https://api.omascote.com.br",
            "token": self.online_token_var.get().strip()
        }
        save_config(self.config_data)
        messagebox.showinfo("OK", "Configuração online salva.")

    def baixar_analytics_online(self):
        data_inicio = self.online_data_var.get().strip()
        data_fim = self.online_ate_var.get().strip()

        api_url = self.online_api_var.get().strip().rstrip("/")
        token = self.online_token_var.get().strip()

        if not data_inicio or not data_fim:
            messagebox.showerror("Erro", "Informe as duas datas.")
            return

        try:
            dt_inicio = datetime.strptime(data_inicio, "%Y-%m-%d")
            dt_fim = datetime.strptime(data_fim, "%Y-%m-%d")
        except Exception:
            messagebox.showerror("Erro", "Datas inválidas. Use YYYY-MM-DD")
            return

        if dt_fim < dt_inicio:
            messagebox.showerror("Erro", "A data final não pode ser menor.")
            return

        if not api_url:
            messagebox.showerror("Erro", "Informe a URL da API.")
            return

        if not token:
            messagebox.showerror("Erro", "Informe o token admin.")
            return

        ANALYTICS_ONLINE_DIR.mkdir(parents=True, exist_ok=True)

        total_baixados = 0
        atual = dt_inicio

        try:
            while atual <= dt_fim:

                data_txt = atual.strftime("%Y-%m-%d")

                url = f"{api_url}/bot/analytics-dia/{data_txt}"

                req = urllib.request.Request(
                    url,
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Accept": "application/json"
                    }
                )

                with urllib.request.urlopen(req, timeout=30) as resp:
                    raw = resp.read().decode("utf-8", errors="ignore")
                    data = json.loads(raw)

                if data.get("ok"):

                    destino = ANALYTICS_ONLINE_DIR / f"{data_txt}.json"

                    destino.write_text(
                        json.dumps(
                            data.get("eventos", []),
                            ensure_ascii=False,
                            indent=2
                        ),
                        encoding="utf-8"
                    )

                    total_baixados += 1

                atual += timedelta(days=1)

            self.online_status_var.set(
                f"{total_baixados} dia(s) baixado(s) com sucesso."
            )

            self.salvar_config_online()
            self.render_online_baixados()

        except urllib.error.HTTPError as e:
            try:
                detalhe = e.read().decode("utf-8", errors="ignore")
            except Exception:
                detalhe = str(e)

            messagebox.showerror("Erro HTTP", detalhe[:500])

        except Exception as e:
            messagebox.showerror("Erro", f"Falha ao baixar analytics: {e}")

    def render_online_baixados(self):
        if not hasattr(self, "tree_online"):
            return

        self.limpar_tree(self.tree_online)

        ANALYTICS_ONLINE_DIR.mkdir(parents=True, exist_ok=True)

        arquivos = sorted(
            ANALYTICS_ONLINE_DIR.glob("*.json"),
            reverse=True
        )

        for arq in arquivos[:300]:
            try:
                tamanho = f"{arq.stat().st_size / 1024:.1f} KB"
                modificado = datetime.fromtimestamp(
                    arq.stat().st_mtime
                ).strftime("%d/%m/%Y %H:%M")

            except Exception:
                tamanho = "-"
                modificado = "-"

            self.tree_online.insert(
                "",
                "end",
                values=(arq.name, tamanho, modificado)
            )

    def abrir_pasta_online(self):
        ANALYTICS_ONLINE_DIR.mkdir(parents=True, exist_ok=True)
        os.startfile(str(ANALYTICS_ONLINE_DIR))

    def abrir_config_valores(self):
        win = tk.Toplevel(self)
        win.title("Valores dos produtos")
        win.geometry("540x430")
        win.transient(self)
        win.grab_set()
        frame = ttk.Frame(win, padding=14)
        frame.pack(fill="both", expand=True)
        ttk.Label(frame, text="Edite os valores manualmente", font=("Segoe UI", 13, "bold")).pack(anchor="w", pady=(0, 10))
        table = ttk.Frame(frame)
        table.pack(fill="both", expand=True)
        ttk.Label(table, text="Código").grid(row=0, column=0, sticky="w", padx=4, pady=4)
        ttk.Label(table, text="Nome").grid(row=0, column=1, sticky="w", padx=4, pady=4)
        ttk.Label(table, text="Valor R$").grid(row=0, column=2, sticky="w", padx=4, pady=4)
        rows = {}
        for i, (cat, info) in enumerate(self.config_data.get("produtos", {}).items(), start=1):
            nome_var = tk.StringVar(value=str(info.get("nome", cat)))
            valor_var = tk.StringVar(value=str(info.get("valor", 0)).replace(".", ","))
            ttk.Label(table, text=cat).grid(row=i, column=0, sticky="w", padx=4, pady=4)
            ttk.Entry(table, textvariable=nome_var, width=24).grid(row=i, column=1, sticky="ew", padx=4, pady=4)
            ttk.Entry(table, textvariable=valor_var, width=10).grid(row=i, column=2, sticky="w", padx=4, pady=4)
            rows[cat] = (nome_var, valor_var)
        table.columnconfigure(1, weight=1)

        def salvar():
            for cat, (nome_var, valor_var) in rows.items():
                raw = valor_var.get().strip().replace(".", "").replace(",", ".")
                try:
                    valor = float(raw)
                except Exception:
                    messagebox.showerror("Erro", f"Valor inválido em {cat}")
                    return
                self.config_data["produtos"][cat] = {"nome": nome_var.get().strip() or cat, "valor": valor}
            save_config(self.config_data)
            self.render()
            win.destroy()

        bottom = ttk.Frame(frame)
        bottom.pack(fill="x", pady=(12, 0))
        ttk.Button(bottom, text="Salvar", command=salvar).pack(side="right")
        ttk.Button(bottom, text="Cancelar", command=win.destroy).pack(side="right", padx=8)


    def toggle_ignorado(self):
        selected = self.tree_clientes.selection()
        if not selected:
            return
        for item in selected:
            cliente = self.tree_clientes.item(item)["values"][0]
            cliente = str(cliente).replace("🚫 ", "")
            if cliente in self.ignorados:
                self.ignorados.remove(cliente)
            else:
                self.ignorados.add(cliente)
        salvar_ignorados(self.ignorados)
        self.aplicar_filtro()

if __name__ == "__main__":
    app = AnalyticsApp()
    app.mainloop()










