# IA4Tube Analytics Studio
# Lê os arquivos baixados do Render em:
# C:\Users\USER\Desktop\resultado\IA4tube\AnalyticsOnline
#
# Requisitos:
# pip install matplotlib

import json
import os
import re
import tkinter as tk
from tkinter import ttk, messagebox
from pathlib import Path
from datetime import datetime
from collections import Counter, defaultdict

try:
    import matplotlib
    matplotlib.use("TkAgg")
    from matplotlib.figure import Figure
    from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
except Exception:
    matplotlib = None

BASE_DIR = Path(__file__).resolve().parent
ANALYTICS_DIR = BASE_DIR / "AnalyticsOnline"

IGNORAR_NOMES = {
    "djohnni dalfovo", "djohnni", "los hermanos", "los hermano",
    "alessandra ohata", "alessandra ohata antonio dalfovo", "admin",
}

IGNORAR_IDS_OU_WPP = {
    "14001169491", "14991169491", "15991120599645", "1599112059874",
    "159911205992313", "15991120599123", "159911205996", "159911220599",
    "google_115385486988704835518",
}

EVENTOS_PRODUTO_FORTES = {
    "selecionou_produto", "tentou_enviar_pedido", "pedido_concluido",
    "erro_envio_pedido", "erro_validacao_pedido", "baixou_imagem",
}

EVENTOS_FUNIL = [
    "pagina_aberta", "selecionou_produto", "tentou_enviar_pedido",
    "pedido_concluido", "baixou_imagem",
]


def normalizar_txt(v):
    return str(v or "").strip().lower()


def normalizar_produto(p):
    p = normalizar_txt(p)
    mapa = {
        "resultado": "resultado_jogo",
        "resultado_jogo": "resultado_jogo",
        "resultado_jogo_jogador": "resultado_jogo_jogador",
        "proximo_jogo": "proximo_jogo",
        "proximo_jogo_jogador": "proximo_jogo_jogador",
        "jogador_escudo": "jogador_escudo",
        "escudo3d": "escudo3d",
        "escudo_3d": "escudo3d",
        "patrocinador": "patrocinador",
        "apoio": "patrocinador",
        "contratacao": "contratacao",
        "escalação": "escalacao",
        "escalacao": "escalacao",
    }
    return mapa.get(p, p)


def nome_produto(p):
    nomes = {
        "resultado_jogo": "Resultado do jogo",
        "resultado_jogo_jogador": "Resultado jogador",
        "proximo_jogo": "Próximo jogo",
        "proximo_jogo_jogador": "Próximo jogo jogador",
        "jogador_escudo": "Jogador + escudo",
        "escudo3d": "Escudo 3D",
        "patrocinador": "Patrocinador/Apoio",
        "contratacao": "Contratação",
        "escalacao": "Escalação",
    }
    return nomes.get(p, p or "Sem produto")


def evento_ignorado(e):
    nome = normalizar_txt(e.get("nome_time"))
    cid = str(e.get("cliente_id") or "").strip()
    wpp = str(e.get("whatsapp") or "").strip()

    if nome in IGNORAR_NOMES:
        return True
    if cid in IGNORAR_IDS_OU_WPP or wpp in IGNORAR_IDS_OU_WPP:
        return True
    if "los hermanos" in nome or "alessandra" in nome or "djohnni" in nome:
        return True
    return False


def cliente_key(e):
    cid = str(e.get("cliente_id") or "").strip()
    wpp = str(e.get("whatsapp") or "").strip()
    nome = str(e.get("nome_time") or "").strip()
    if cid:
        return cid
    if wpp:
        return wpp
    if nome:
        return nome.lower()
    return str(e.get("sessao") or "anonimo")


def cliente_nome(e):
    nome = str(e.get("nome_time") or "").strip()
    wpp = str(e.get("whatsapp") or "").strip()
    cid = str(e.get("cliente_id") or "").strip()
    if nome:
        return nome
    if wpp:
        return wpp
    if cid:
        return cid
    return "Anônimo"


def parse_data(e):
    raw = str(e.get("data") or "")
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except Exception:
        return None


def carregar_eventos():
    ANALYTICS_DIR.mkdir(parents=True, exist_ok=True)
    eventos = []
    for arq in sorted(ANALYTICS_DIR.glob("*.json")):
        try:
            data = json.loads(arq.read_text(encoding="utf-8"))
            if isinstance(data, list):
                lista = data
            elif isinstance(data, dict):
                lista = data.get("eventos", [])
            else:
                lista = []
            for e in lista:
                if isinstance(e, dict):
                    e["_arquivo"] = arq.name
                    eventos.append(e)
        except Exception:
            pass
    return eventos


def filtrar_reais(eventos):
    return [e for e in eventos if not evento_ignorado(e)]


def contar_entradas_por_cliente(eventos):
    por_cliente_sessoes = defaultdict(set)
    nomes = {}
    for e in eventos:
        if e.get("evento") != "pagina_aberta":
            continue
        key = cliente_key(e)
        sessao = str(e.get("sessao") or "")
        por_cliente_sessoes[key].add(sessao or str(parse_data(e) or ""))
        nomes.setdefault(key, cliente_nome(e))
    linhas = [(nomes.get(key, key), key, len(sessoes)) for key, sessoes in por_cliente_sessoes.items()]
    linhas.sort(key=lambda x: x[2], reverse=True)
    return linhas


def resumo_geral(eventos):
    clientes = set()
    sessoes = set()
    pedidos = set()
    downloads = 0
    anonimos = 0
    for e in eventos:
        key = cliente_key(e)
        if cliente_nome(e) == "Anônimo":
            anonimos += 1
        else:
            clientes.add(key)
        if e.get("sessao"):
            sessoes.add(e.get("sessao"))
        if e.get("evento") == "pedido_concluido":
            pid = e.get("pedido_id")
            if pid:
                pedidos.add(pid)
        if e.get("evento") == "baixou_imagem":
            downloads += 1
    return {"eventos": len(eventos), "clientes": len(clientes), "sessoes": len(sessoes), "pedidos": len(pedidos), "downloads": downloads, "anonimos": anonimos}


def top_produtos(eventos):
    cont = Counter(); selecionou = Counter(); tentou = Counter(); concluiu = Counter(); baixou = Counter(); erro = Counter()
    for e in eventos:
        produto = normalizar_produto(e.get("produto"))
        if not produto:
            continue
        ev = e.get("evento")
        if ev in EVENTOS_PRODUTO_FORTES:
            cont[produto] += 1
        if ev == "selecionou_produto":
            selecionou[produto] += 1
        elif ev == "tentou_enviar_pedido":
            tentou[produto] += 1
        elif ev == "pedido_concluido":
            concluiu[produto] += 1
        elif ev == "baixou_imagem":
            baixou[produto] += 1
        elif ev in ("erro_envio_pedido", "erro_validacao_pedido"):
            erro[produto] += 1
    produtos = set(cont) | set(selecionou) | set(tentou) | set(concluiu) | set(baixou) | set(erro)
    linhas = []
    for p in produtos:
        linhas.append({"produto": p, "nome": nome_produto(p), "uso": cont[p], "selecionou": selecionou[p], "tentou": tentou[p], "concluiu": concluiu[p], "baixou": baixou[p], "erro": erro[p]})
    linhas.sort(key=lambda x: (x["uso"], x["concluiu"], x["tentou"]), reverse=True)
    return linhas


def funil(eventos):
    c = Counter(); clientes_por_etapa = defaultdict(set)
    for e in eventos:
        ev = e.get("evento")
        if ev not in EVENTOS_FUNIL:
            continue
        c[ev] += 1
        clientes_por_etapa[ev].add(cliente_key(e))
    return [(ev, c[ev], len(clientes_por_etapa[ev])) for ev in EVENTOS_FUNIL]


def eventos_por_dia(eventos):
    c = Counter()
    for e in eventos:
        dt = parse_data(e)
        if dt:
            c[dt.strftime("%Y-%m-%d")] += 1
    return sorted(c.items())


def top_cliques(eventos):
    c = Counter()
    for e in eventos:
        if e.get("evento") != "click_interface":
            continue
        payload = e.get("payload") or {}
        alvo = str(payload.get("alvo") or e.get("campo_atual") or "").strip()
        if alvo:
            alvo = re.sub(r"\s+", " ", alvo)
            c[alvo] += 1
    return c.most_common(30)


def erros_por_produto(eventos):
    detalhes = Counter()
    for e in eventos:
        if e.get("evento") not in ("erro_envio_pedido", "erro_validacao_pedido"):
            continue
        produto = normalizar_produto(e.get("produto")) or "sem_produto"
        payload = e.get("payload") or {}
        erro = str(payload.get("erro") or e.get("ultima_acao") or e.get("evento") or "").strip()
        detalhes[(produto, erro)] += 1
    return detalhes


class AnalyticsStudio(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("IA4Tube Analytics Studio")
        self.geometry("1180x760")
        self.minsize(980, 620)
        self.eventos_brutos = []
        self.eventos = []
        self.style = ttk.Style()
        try:
            self.style.theme_use("clam")
        except Exception:
            pass
        self.build_ui()
        self.recarregar()

    def build_ui(self):
        top = ttk.Frame(self, padding=10); top.pack(fill="x")
        ttk.Label(top, text="IA4Tube Analytics Studio", font=("Segoe UI", 16, "bold")).pack(side="left")
        ttk.Button(top, text="Recarregar", command=self.recarregar).pack(side="right", padx=4)
        ttk.Button(top, text="Abrir pasta AnalyticsOnline", command=self.abrir_pasta).pack(side="right", padx=4)
        ttk.Label(self, text=f"Pasta: {ANALYTICS_DIR}", padding=(10, 0)).pack(fill="x")

        self.cards = ttk.Frame(self, padding=10); self.cards.pack(fill="x")
        self.card_vars = {}
        for key, label in [("eventos", "Eventos"), ("clientes", "Clientes reais"), ("sessoes", "Entradas/sessões"), ("pedidos", "Pedidos"), ("downloads", "Downloads"), ("anonimos", "Eventos anônimos")]:
            frame = ttk.LabelFrame(self.cards, text=label, padding=8)
            frame.pack(side="left", fill="x", expand=True, padx=4)
            var = tk.StringVar(value="0"); self.card_vars[key] = var
            ttk.Label(frame, textvariable=var, font=("Segoe UI", 18, "bold")).pack()

        self.tabs = ttk.Notebook(self); self.tabs.pack(fill="both", expand=True, padx=10, pady=10)
        self.tab_produtos = ttk.Frame(self.tabs, padding=8); self.tab_clientes = ttk.Frame(self.tabs, padding=8)
        self.tab_funil = ttk.Frame(self.tabs, padding=8); self.tab_cliques = ttk.Frame(self.tabs, padding=8)
        self.tab_erros = ttk.Frame(self.tabs, padding=8); self.tab_graficos = ttk.Frame(self.tabs, padding=8)
        self.tabs.add(self.tab_produtos, text="Produtos"); self.tabs.add(self.tab_clientes, text="Clientes")
        self.tabs.add(self.tab_funil, text="Funil"); self.tabs.add(self.tab_cliques, text="Cliques")
        self.tabs.add(self.tab_erros, text="Erros"); self.tabs.add(self.tab_graficos, text="Gráficos")

        self.tree_produtos = self.build_tree(self.tab_produtos, ("produto", "uso", "selecionou", "tentou", "concluiu", "baixou", "erro"), ("Produto", "Uso forte", "Selecionou", "Tentou", "Concluiu", "Baixou", "Erros"), (220, 90, 90, 90, 90, 90, 90))
        self.tree_clientes = self.build_tree(self.tab_clientes, ("cliente", "id", "entradas"), ("Cliente", "ID/WhatsApp", "Entradas"), (260, 220, 90))
        self.tree_funil = self.build_tree(self.tab_funil, ("etapa", "eventos", "clientes"), ("Etapa", "Eventos", "Clientes únicos"), (240, 120, 140))
        self.tree_cliques = self.build_tree(self.tab_cliques, ("alvo", "cliques"), ("Onde clicaram", "Cliques"), (520, 120))
        self.tree_erros = self.build_tree(self.tab_erros, ("produto", "erro", "quantidade"), ("Produto", "Erro", "Quantidade"), (200, 560, 120))
        self.graf_frame = ttk.Frame(self.tab_graficos); self.graf_frame.pack(fill="both", expand=True)

    def build_tree(self, parent, columns, headings, widths):
        tree = ttk.Treeview(parent, columns=columns, show="headings", height=22)
        yscroll = ttk.Scrollbar(parent, orient="vertical", command=tree.yview)
        xscroll = ttk.Scrollbar(parent, orient="horizontal", command=tree.xview)
        tree.configure(yscrollcommand=yscroll.set, xscrollcommand=xscroll.set)
        tree.grid(row=0, column=0, sticky="nsew"); yscroll.grid(row=0, column=1, sticky="ns"); xscroll.grid(row=1, column=0, sticky="ew")
        parent.rowconfigure(0, weight=1); parent.columnconfigure(0, weight=1)
        for col, head, width in zip(columns, headings, widths):
            tree.heading(col, text=head); tree.column(col, width=width, anchor="w")
        return tree

    def limpar_tree(self, tree):
        for item in tree.get_children():
            tree.delete(item)

    def abrir_pasta(self):
        ANALYTICS_DIR.mkdir(parents=True, exist_ok=True)
        os.startfile(str(ANALYTICS_DIR))

    def recarregar(self):
        self.eventos_brutos = carregar_eventos()
        self.eventos = filtrar_reais(self.eventos_brutos)
        self.render_resumo(); self.render_produtos(); self.render_clientes(); self.render_funil(); self.render_cliques(); self.render_erros(); self.render_graficos()
        if not self.eventos_brutos:
            messagebox.showwarning("Sem arquivos", f"Nenhum JSON encontrado em:\n{ANALYTICS_DIR}\n\nBaixe os dias pelo painel atual primeiro.")

    def render_resumo(self):
        r = resumo_geral(self.eventos)
        for key, var in self.card_vars.items():
            var.set(str(r.get(key, 0)))

    def render_produtos(self):
        self.limpar_tree(self.tree_produtos)
        for item in top_produtos(self.eventos):
            self.tree_produtos.insert("", "end", values=(item["nome"], item["uso"], item["selecionou"], item["tentou"], item["concluiu"], item["baixou"], item["erro"]))

    def render_clientes(self):
        self.limpar_tree(self.tree_clientes)
        for nome, key, qtd in contar_entradas_por_cliente(self.eventos):
            self.tree_clientes.insert("", "end", values=(nome, key, qtd))

    def render_funil(self):
        self.limpar_tree(self.tree_funil)
        nomes = {"pagina_aberta": "Entrou no site", "selecionou_produto": "Selecionou produto", "tentou_enviar_pedido": "Tentou enviar pedido", "pedido_concluido": "Pedido concluído", "baixou_imagem": "Baixou imagem"}
        for ev, qtd, clientes in funil(self.eventos):
            self.tree_funil.insert("", "end", values=(nomes.get(ev, ev), qtd, clientes))

    def render_cliques(self):
        self.limpar_tree(self.tree_cliques)
        for alvo, qtd in top_cliques(self.eventos):
            self.tree_cliques.insert("", "end", values=(alvo, qtd))

    def render_erros(self):
        self.limpar_tree(self.tree_erros)
        for (produto, erro), qtd in erros_por_produto(self.eventos).most_common(100):
            self.tree_erros.insert("", "end", values=(nome_produto(produto), erro or "-", qtd))

    def render_graficos(self):
        for w in self.graf_frame.winfo_children():
            w.destroy()
        if matplotlib is None:
            ttk.Label(self.graf_frame, text="Matplotlib não instalado. Rode: pip install matplotlib", font=("Segoe UI", 12, "bold")).pack(pady=20)
            return
        produtos = top_produtos(self.eventos)[:8]
        dias = eventos_por_dia(self.eventos)
        if not produtos and not dias:
            ttk.Label(self.graf_frame, text="Sem dados para gráficos.").pack(pady=20)
            return
        fig = Figure(figsize=(11, 7), dpi=100)
        ax1 = fig.add_subplot(211); ax2 = fig.add_subplot(212)
        if produtos:
            nomes = [p["nome"] for p in produtos]
            valores = [p["uso"] for p in produtos]
            ax1.barh(nomes[::-1], valores[::-1])
            ax1.set_title("Top 8 produtos por uso forte")
            ax1.set_xlabel("Interações fortes")
        else:
            ax1.text(0.5, 0.5, "Sem dados", ha="center", va="center")
        if dias:
            x = [d for d, _ in dias]; y = [q for _, q in dias]
            ax2.plot(x, y, marker="o")
            ax2.set_title("Eventos por dia")
            ax2.set_ylabel("Eventos")
            ax2.tick_params(axis="x", rotation=30)
        else:
            ax2.text(0.5, 0.5, "Sem dados", ha="center", va="center")
        fig.tight_layout()
        canvas = FigureCanvasTkAgg(fig, master=self.graf_frame)
        canvas.draw()
        canvas.get_tk_widget().pack(fill="both", expand=True)


if __name__ == "__main__":
    app = AnalyticsStudio()
    app.mainloop()
