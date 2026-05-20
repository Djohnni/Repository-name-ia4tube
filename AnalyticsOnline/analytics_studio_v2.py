# IA4Tube Analytics Studio
# Lê os arquivos baixados do Render em:
# C:\Users\USER\Desktop\resultado\IA4tube\AnalyticsOnline
#
# Opcional para mostrar saldo atual:
# coloque uma cópia do /var/data/clientes.json em:
# C:\Users\USER\Desktop\resultado\IA4tube\clientes.json
# ou:
# C:\Users\USER\Desktop\resultado\IA4tube\AnalyticsOnline\clientes.json
#
# Requisitos:
# pip install matplotlib

import json
import os
import re
import tkinter as tk
from tkinter import ttk, messagebox
from pathlib import Path
from datetime import datetime, timezone
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

CLIENTES_JSON_CANDIDATOS = [
    BASE_DIR / "clientes.json",
    ANALYTICS_DIR / "clientes.json",
]

IGNORAR_NOMES = {
    "djohnni dalfovo",
    "djohnni",
    "los hermanos",
    "los hermano",
    "alessandra ohata",
    "alessandra ohata antonio dalfovo",
    "admin",
}

IGNORAR_IDS_OU_WPP = {
    "14001169491",
    "14991169491",
    "15991120599645",
    "1599112059874",
    "159911205992313",
    "15991120599123",
    "159911205996",
    "159911220599",
    "google_115385486988704835518",
}

EVENTOS_PRODUTO_FORTES = {
    "selecionou_produto",
    "tentou_enviar_pedido",
    "pedido_concluido",
    "erro_envio_pedido",
    "erro_validacao_pedido",
    "baixou_imagem",
}

EVENTOS_FUNIL = [
    "pagina_aberta",
    "selecionou_produto",
    "tentou_enviar_pedido",
    "pedido_concluido",
    "baixou_imagem",
]

PRECO_PRODUTOS = {
    "resultado_jogo": 8.0,
    "resultado": 8.0,
    "escalacao": 8.0,
    "contratacao": 7.0,
    "proximo_jogo": 7.0,
    "patrocinador": 8.0,
    "escudo3d": 4.0,
    "escudo_3d": 4.0,
    "jogador_escudo": 6.0,
    "proximo_jogo_jogador": 7.0,
    "resultado_jogo_jogador": 8.0,
}


def normalizar_txt(v):
    return str(v or "").strip().lower()


def normalizar_numero(v):
    return re.sub(r"\D+", "", str(v or ""))


def dinheiro(v):
    if v is None:
        return "-"
    try:
        return f"R$ {float(v):.2f}".replace(".", ",")
    except Exception:
        return "-"


def valor_float(v, padrao=0.0):
    try:
        if v is None or v == "":
            return padrao
        if isinstance(v, str):
            v = v.replace("R$", "").replace(" ", "").replace(".", "").replace(",", ".")
        return float(v)
    except Exception:
        return padrao


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


def preco_produto(produto):
    produto = normalizar_produto(produto)
    return PRECO_PRODUTOS.get(produto, 0.0)


def evento_ignorado(e):
    nome = normalizar_txt(e.get("nome_time"))
    cid = str(e.get("cliente_id") or "").strip()
    wpp = str(e.get("whatsapp") or "").strip()

    if nome in IGNORAR_NOMES:
        return True
    if cid in IGNORAR_IDS_OU_WPP or wpp in IGNORAR_IDS_OU_WPP:
        return True
    if normalizar_numero(cid) in IGNORAR_IDS_OU_WPP or normalizar_numero(wpp) in IGNORAR_IDS_OU_WPP:
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
        if arq.name.lower() == "clientes.json":
            continue
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


def carregar_clientes_json():
    for caminho in CLIENTES_JSON_CANDIDATOS:
        if not caminho.exists():
            continue
        try:
            data = json.loads(caminho.read_text(encoding="utf-8"))
            return normalizar_clientes_json(data), caminho
        except Exception:
            pass
    return {}, None


def normalizar_clientes_json(data):
    clientes = {}

    if isinstance(data, dict):
        if "clientes" in data and isinstance(data["clientes"], list):
            lista = data["clientes"]
        elif "clientes" in data and isinstance(data["clientes"], dict):
            lista = list(data["clientes"].values())
        else:
            lista = []
            for k, v in data.items():
                if isinstance(v, dict):
                    item = dict(v)
                    item.setdefault("whatsapp", k)
                    lista.append(item)
    elif isinstance(data, list):
        lista = data
    else:
        lista = []

    for c in lista:
        if not isinstance(c, dict):
            continue

        nome = str(c.get("nome_time") or c.get("nome") or c.get("time") or "").strip()
        wpp = str(c.get("whatsapp") or c.get("telefone") or c.get("numero") or "").strip()
        cid = str(c.get("cliente_id") or c.get("id") or wpp or "").strip()

        chaves = set()
        for x in (cid, wpp, normalizar_numero(wpp), normalizar_numero(cid), nome.lower()):
            if x:
                chaves.add(x)

        saldo_atual = calcular_saldo_atual_cliente(c)

        info = {
            "nome": nome,
            "whatsapp": wpp,
            "cliente_id": cid,
            "saldo_atual": saldo_atual,
            "raw": c,
        }

        for chave in chaves:
            clientes[chave] = info

    return clientes


def calcular_saldo_atual_cliente(c):
    # Prioridade para nomes comuns do teu sistema.
    if "saldo_extra" in c:
        return valor_float(c.get("saldo_extra"))
    if "saldo" in c:
        return valor_float(c.get("saldo"))
    if "creditos" in c:
        return valor_float(c.get("creditos"))
    if "saldo_disponivel" in c:
        return valor_float(c.get("saldo_disponivel"))

    # Fallback: soma campos que parecem saldo/crédito disponível.
    total = 0.0
    achou = False
    for k, v in c.items():
        kk = normalizar_txt(k)
        if "saldo" in kk or "credito" in kk or "crédito" in kk:
            if "usado" in kk or "gasto" in kk or "historico" in kk:
                continue
            total += valor_float(v)
            achou = True
    return total if achou else None


def achar_info_cliente(clientes_json, key, nome, whatsapp):
    candidatos = [
        str(key or "").strip(),
        str(whatsapp or "").strip(),
        normalizar_numero(whatsapp),
        normalizar_numero(key),
        str(nome or "").strip().lower(),
    ]

    for c in candidatos:
        if c and c in clientes_json:
            return clientes_json[c]

    return None


def contar_entradas_por_cliente(eventos, clientes_json=None):
    clientes_json = clientes_json or {}

    dados = {}

    for e in eventos:
        key = cliente_key(e)
        nome = cliente_nome(e)
        wpp = str(e.get("whatsapp") or "").strip()
        sessao = str(e.get("sessao") or "")
        dt = parse_data(e)

        if key not in dados:
            dados[key] = {
                "nome": nome,
                "id": key,
                "whatsapp": wpp,
                "sessoes": set(),
                "ultimo_evento": None,
                "pedidos": set(),
                "downloads": 0,
                "erros": 0,
                "ultimo_erro": "",
                "gasto_estimado": 0.0,
                "produtos_concluidos": Counter(),
            }

        if e.get("evento") == "pagina_aberta":
            dados[key]["sessoes"].add(sessao or str(dt or ""))

        if dt and (dados[key]["ultimo_evento"] is None or dt > dados[key]["ultimo_evento"]):
            dados[key]["ultimo_evento"] = dt

        ev = e.get("evento")
        produto = normalizar_produto(e.get("produto"))

        if ev == "pedido_concluido":
            pid = e.get("pedido_id") or f"{key}_{dt}"
            if pid not in dados[key]["pedidos"]:
                dados[key]["pedidos"].add(pid)
                dados[key]["gasto_estimado"] += preco_produto(produto)
                if produto:
                    dados[key]["produtos_concluidos"][produto] += 1

        if ev == "baixou_imagem":
            dados[key]["downloads"] += 1

        if ev in ("erro_envio_pedido", "erro_validacao_pedido"):
            dados[key]["erros"] += 1
            payload = e.get("payload") or {}
            erro_txt = str(payload.get("erro") or ev or "").strip()
            if erro_txt:
                dados[key]["ultimo_erro"] = erro_txt

    agora = datetime.now(timezone.utc)
    linhas = []

    for key, d in dados.items():
        ultimo = d["ultimo_evento"]
        dias_inativo = "-"
        ultimo_txt = "-"

        if ultimo:
            if ultimo.tzinfo is None:
                ultimo = ultimo.replace(tzinfo=timezone.utc)
            delta = agora - ultimo
            dias_inativo = max(delta.days, 0)
            ultimo_txt = ultimo.astimezone().strftime("%d/%m/%Y %H:%M")

        info_json = achar_info_cliente(clientes_json, key, d["nome"], d["whatsapp"])
        saldo_atual = None

        if info_json:
            saldo_atual = info_json.get("saldo_atual")
            if info_json.get("whatsapp") and not d["whatsapp"]:
                d["whatsapp"] = info_json.get("whatsapp")
            if info_json.get("nome") and (not d["nome"] or d["nome"] == "Anônimo"):
                d["nome"] = info_json.get("nome")

        total_saldo_mais_gasto = None
        if saldo_atual is not None:
            total_saldo_mais_gasto = valor_float(saldo_atual) + d["gasto_estimado"]

        linhas.append({
            "nome": d["nome"],
            "id": key,
            "whatsapp": d["whatsapp"],
            "entradas": len(d["sessoes"]),
            "dias_inativo": dias_inativo,
            "ultimo_evento": ultimo_txt,
            "pedidos": len(d["pedidos"]),
            "downloads": d["downloads"],
            "erros": d["erros"],
            "ultimo_erro": d["ultimo_erro"],
            "gasto_estimado": d["gasto_estimado"],
            "saldo_atual": saldo_atual,
            "total_saldo_mais_gasto": total_saldo_mais_gasto,
        })

    linhas.sort(key=lambda x: (x["entradas"], x["pedidos"], x["downloads"]), reverse=True)
    return linhas


def resumo_geral(eventos):
    clientes = set()
    sessoes = set()
    pedidos = set()
    downloads = 0
    anonimos = 0
    erros = 0

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
        if e.get("evento") in ("erro_envio_pedido", "erro_validacao_pedido"):
            erros += 1

    return {
        "eventos": len(eventos),
        "clientes": len(clientes),
        "sessoes": len(sessoes),
        "pedidos": len(pedidos),
        "downloads": downloads,
        "anonimos": anonimos,
        "erros": erros,
    }


def top_produtos(eventos):
    cont = Counter()
    selecionou = Counter()
    tentou = Counter()
    concluiu = Counter()
    baixou = Counter()
    erro = Counter()

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
        linhas.append({
            "produto": p,
            "nome": nome_produto(p),
            "uso": cont[p],
            "selecionou": selecionou[p],
            "tentou": tentou[p],
            "concluiu": concluiu[p],
            "baixou": baixou[p],
            "erro": erro[p],
        })

    linhas.sort(key=lambda x: (x["uso"], x["concluiu"], x["tentou"]), reverse=True)
    return linhas


def funil(eventos):
    c = Counter()
    clientes_por_etapa = defaultdict(set)

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
    por_cliente = Counter()

    for e in eventos:
        if e.get("evento") not in ("erro_envio_pedido", "erro_validacao_pedido"):
            continue

        produto = normalizar_produto(e.get("produto")) or "sem_produto"
        payload = e.get("payload") or {}
        erro = str(payload.get("erro") or e.get("ultima_acao") or e.get("evento") or "").strip()
        detalhes[(produto, erro)] += 1

        por_cliente[(cliente_nome(e), cliente_key(e), produto, erro)] += 1

    return detalhes, por_cliente


class AnalyticsStudio(tk.Tk):
    def __init__(self):
        super().__init__()

        self.title("IA4Tube Analytics Studio")
        self.geometry("1320x790")
        self.minsize(1100, 650)

        self.eventos_brutos = []
        self.eventos = []
        self.clientes_json = {}
        self.clientes_json_path = None

        self.style = ttk.Style()
        try:
            self.style.theme_use("clam")
        except Exception:
            pass

        self.build_ui()
        self.recarregar()

    def build_ui(self):
        top = ttk.Frame(self, padding=10)
        top.pack(fill="x")

        ttk.Label(top, text="IA4Tube Analytics Studio", font=("Segoe UI", 16, "bold")).pack(side="left")

        ttk.Button(top, text="Recarregar", command=self.recarregar).pack(side="right", padx=4)
        ttk.Button(top, text="Abrir pasta AnalyticsOnline", command=self.abrir_pasta).pack(side="right", padx=4)

        self.lbl_pasta = ttk.Label(self, text=f"Pasta: {ANALYTICS_DIR}", padding=(10, 0))
        self.lbl_pasta.pack(fill="x")

        self.lbl_clientes_json = ttk.Label(self, text="clientes.json: não encontrado", padding=(10, 0))
        self.lbl_clientes_json.pack(fill="x")

        self.cards = ttk.Frame(self, padding=10)
        self.cards.pack(fill="x")

        self.card_vars = {}
        for key, label in [
            ("eventos", "Eventos"),
            ("clientes", "Clientes reais"),
            ("sessoes", "Entradas/sessões"),
            ("pedidos", "Pedidos"),
            ("downloads", "Downloads"),
            ("erros", "Erros"),
            ("anonimos", "Eventos anônimos"),
        ]:
            frame = ttk.LabelFrame(self.cards, text=label, padding=8)
            frame.pack(side="left", fill="x", expand=True, padx=4)
            var = tk.StringVar(value="0")
            self.card_vars[key] = var
            ttk.Label(frame, textvariable=var, font=("Segoe UI", 18, "bold")).pack()

        self.tabs = ttk.Notebook(self)
        self.tabs.pack(fill="both", expand=True, padx=10, pady=10)

        self.tab_produtos = ttk.Frame(self.tabs, padding=8)
        self.tab_clientes = ttk.Frame(self.tabs, padding=8)
        self.tab_funil = ttk.Frame(self.tabs, padding=8)
        self.tab_cliques = ttk.Frame(self.tabs, padding=8)
        self.tab_erros = ttk.Frame(self.tabs, padding=8)
        self.tab_graficos = ttk.Frame(self.tabs, padding=8)

        self.tabs.add(self.tab_produtos, text="Produtos")
        self.tabs.add(self.tab_clientes, text="Clientes")
        self.tabs.add(self.tab_funil, text="Funil")
        self.tabs.add(self.tab_cliques, text="Cliques")
        self.tabs.add(self.tab_erros, text="Erros")
        self.tabs.add(self.tab_graficos, text="Gráficos")

        self.tree_produtos = self.build_tree(
            self.tab_produtos,
            ("produto", "uso", "selecionou", "tentou", "concluiu", "baixou", "erro"),
            ("Produto", "Uso forte", "Selecionou", "Tentou", "Concluiu", "Baixou", "Erros"),
            (220, 90, 90, 90, 90, 90, 90),
        )

        clientes_top = ttk.Frame(self.tab_clientes)
        clientes_top.pack(fill="x", pady=(0, 8))

        ttk.Button(clientes_top, text="Copiar ID/WhatsApp selecionado", command=self.copiar_cliente_id).pack(side="left", padx=(0, 6))
        ttk.Button(clientes_top, text="Copiar resumo do cliente", command=self.copiar_cliente_resumo).pack(side="left", padx=6)

        self.tree_clientes = self.build_tree(
            self.tab_clientes,
            (
                "cliente",
                "id",
                "whatsapp",
                "entradas",
                "dias_inativo",
                "ultimo_evento",
                "pedidos",
                "downloads",
                "erros",
                "gasto",
                "saldo_atual",
                "saldo_mais_gasto",
                "ultimo_erro",
            ),
            (
                "Cliente",
                "ID",
                "WhatsApp",
                "Entradas",
                "Dias inativo",
                "Último evento",
                "Pedidos",
                "Downloads",
                "Erros",
                "Já gastou",
                "Saldo hoje",
                "Saldo + gasto",
                "Último erro",
            ),
            (230, 180, 130, 80, 90, 135, 70, 80, 60, 90, 90, 105, 360),
        )

        self.tree_funil = self.build_tree(
            self.tab_funil,
            ("etapa", "eventos", "clientes"),
            ("Etapa", "Eventos", "Clientes únicos"),
            (240, 120, 140),
        )

        self.tree_cliques = self.build_tree(
            self.tab_cliques,
            ("alvo", "cliques"),
            ("Onde clicaram", "Cliques"),
            (620, 120),
        )

        self.tree_erros = self.build_tree(
            self.tab_erros,
            ("cliente", "id", "produto", "erro", "quantidade"),
            ("Cliente", "ID/WhatsApp", "Produto", "Erro", "Quantidade"),
            (210, 180, 180, 560, 100),
        )

        self.graf_frame = ttk.Frame(self.tab_graficos)
        self.graf_frame.pack(fill="both", expand=True)

    def build_tree(self, parent, columns, headings, widths):
        container = ttk.Frame(parent)
        container.pack(fill="both", expand=True)

        tree = ttk.Treeview(container, columns=columns, show="headings", height=22)

        yscroll = ttk.Scrollbar(container, orient="vertical", command=tree.yview)
        xscroll = ttk.Scrollbar(container, orient="horizontal", command=tree.xview)
        tree.configure(yscrollcommand=yscroll.set, xscrollcommand=xscroll.set)

        tree.grid(row=0, column=0, sticky="nsew")
        yscroll.grid(row=0, column=1, sticky="ns")
        xscroll.grid(row=1, column=0, sticky="ew")

        container.rowconfigure(0, weight=1)
        container.columnconfigure(0, weight=1)

        for col, head, width in zip(columns, headings, widths):
            tree.heading(col, text=head)
            tree.column(col, width=width, anchor="w")

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
        self.clientes_json, self.clientes_json_path = carregar_clientes_json()

        if self.clientes_json_path:
            self.lbl_clientes_json.config(text=f"clientes.json: {self.clientes_json_path}")
        else:
            self.lbl_clientes_json.config(text="clientes.json: não encontrado | saldo atual ficará vazio")

        self.render_resumo()
        self.render_produtos()
        self.render_clientes()
        self.render_funil()
        self.render_cliques()
        self.render_erros()
        self.render_graficos()

        if not self.eventos_brutos:
            messagebox.showwarning(
                "Sem arquivos",
                f"Nenhum JSON encontrado em:\n{ANALYTICS_DIR}\n\nBaixe os dias pelo painel atual primeiro."
            )

    def render_resumo(self):
        r = resumo_geral(self.eventos)
        for key, var in self.card_vars.items():
            var.set(str(r.get(key, 0)))

    def render_produtos(self):
        self.limpar_tree(self.tree_produtos)
        for item in top_produtos(self.eventos):
            self.tree_produtos.insert(
                "",
                "end",
                values=(
                    item["nome"],
                    item["uso"],
                    item["selecionou"],
                    item["tentou"],
                    item["concluiu"],
                    item["baixou"],
                    item["erro"],
                )
            )

    def render_clientes(self):
        self.limpar_tree(self.tree_clientes)

        for item in contar_entradas_por_cliente(self.eventos, self.clientes_json):
            self.tree_clientes.insert(
                "",
                "end",
                values=(
                    item["nome"],
                    item["id"],
                    item["whatsapp"],
                    item["entradas"],
                    item["dias_inativo"],
                    item["ultimo_evento"],
                    item["pedidos"],
                    item["downloads"],
                    item["erros"],
                    dinheiro(item["gasto_estimado"]),
                    dinheiro(item["saldo_atual"]),
                    dinheiro(item["total_saldo_mais_gasto"]),
                    item["ultimo_erro"],
                )
            )

    def copiar_cliente_id(self):
        item_id = self.tree_clientes.focus()
        if not item_id:
            messagebox.showwarning("Selecione um cliente", "Clique em um cliente primeiro.")
            return

        values = self.tree_clientes.item(item_id, "values")
        if not values:
            return

        id_cliente = values[2] or values[1]

        self.clipboard_clear()
        self.clipboard_append(str(id_cliente))
        self.update()

        messagebox.showinfo("Copiado", f"Copiado:\n{id_cliente}")

    def copiar_cliente_resumo(self):
        item_id = self.tree_clientes.focus()
        if not item_id:
            messagebox.showwarning("Selecione um cliente", "Clique em um cliente primeiro.")
            return

        values = self.tree_clientes.item(item_id, "values")
        if not values:
            return

        texto = (
            f"Cliente: {values[0]}\n"
            f"ID: {values[1]}\n"
            f"WhatsApp: {values[2]}\n"
            f"Entradas: {values[3]}\n"
            f"Dias inativo: {values[4]}\n"
            f"Último evento: {values[5]}\n"
            f"Pedidos: {values[6]}\n"
            f"Downloads: {values[7]}\n"
            f"Erros: {values[8]}\n"
            f"Já gastou: {values[9]}\n"
            f"Saldo hoje: {values[10]}\n"
            f"Saldo + gasto: {values[11]}\n"
            f"Último erro: {values[12]}"
        )

        self.clipboard_clear()
        self.clipboard_append(texto)
        self.update()

        messagebox.showinfo("Copiado", "Resumo do cliente copiado.")

    def render_funil(self):
        self.limpar_tree(self.tree_funil)
        nomes = {
            "pagina_aberta": "Entrou no site",
            "selecionou_produto": "Selecionou produto",
            "tentou_enviar_pedido": "Tentou enviar pedido",
            "pedido_concluido": "Pedido concluído",
            "baixou_imagem": "Baixou imagem",
        }
        for ev, qtd, clientes in funil(self.eventos):
            self.tree_funil.insert("", "end", values=(nomes.get(ev, ev), qtd, clientes))

    def render_cliques(self):
        self.limpar_tree(self.tree_cliques)
        for alvo, qtd in top_cliques(self.eventos):
            self.tree_cliques.insert("", "end", values=(alvo, qtd))

    def render_erros(self):
        self.limpar_tree(self.tree_erros)
        _, por_cliente = erros_por_produto(self.eventos)

        for (cliente, key, produto, erro), qtd in por_cliente.most_common(200):
            self.tree_erros.insert(
                "",
                "end",
                values=(cliente, key, nome_produto(produto), erro or "-", qtd)
            )

    def render_graficos(self):
        for w in self.graf_frame.winfo_children():
            w.destroy()

        if matplotlib is None:
            ttk.Label(
                self.graf_frame,
                text="Matplotlib não instalado. Rode: pip install matplotlib",
                font=("Segoe UI", 12, "bold")
            ).pack(pady=20)
            return

        produtos = top_produtos(self.eventos)[:8]
        dias = eventos_por_dia(self.eventos)

        if not produtos and not dias:
            ttk.Label(self.graf_frame, text="Sem dados para gráficos.").pack(pady=20)
            return

        fig = Figure(figsize=(11, 7), dpi=100)
        ax1 = fig.add_subplot(211)
        ax2 = fig.add_subplot(212)

        if produtos:
            nomes = [p["nome"] for p in produtos]
            valores = [p["uso"] for p in produtos]
            ax1.barh(nomes[::-1], valores[::-1])
            ax1.set_title("Top 8 produtos por uso forte")
            ax1.set_xlabel("Interações fortes")
        else:
            ax1.text(0.5, 0.5, "Sem dados", ha="center", va="center")

        if dias:
            x = [d for d, _ in dias]
            y = [q for _, q in dias]
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
