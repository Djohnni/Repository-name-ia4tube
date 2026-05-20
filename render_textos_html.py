
import json
import subprocess
import html
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
W = 1024
H = 1536

CHROME_CANDIDATES = [
    Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
]

def load_json(p: Path) -> dict:
    return json.loads(p.read_text(encoding="utf-8"))

def find_chrome() -> Path:
    for p in CHROME_CANDIDATES:
        if p.exists():
            return p
    raise FileNotFoundError("Chrome não encontrado nos caminhos padrão.")

def esc(txt) -> str:
    return html.escape("" if txt is None else str(txt))

def css_weight(v) -> str:
    s = str(v or "").strip().lower()
    if not s:
        return "400"
    if s == "normal":
        return "400"
    if s == "bold":
        return "700"
    if s == "black":
        return "900"
    return s

def css_align(v) -> str:
    s = str(v or "").strip().lower()
    if s in {"left", "right", "center"}:
        return s
    return "center"

def safe_int(v, default):
    try:
        return int(float(v))
    except Exception:
        return default

def safe_float(v, default):
    try:
        return float(v)
    except Exception:
        return default

def css_text_shadow(cfg: dict) -> str:
    if not bool(cfg.get("shadow_enabled", False)):
        return "none"
    sx = safe_int(cfg.get("shadow_x", 0), 0)
    sy = safe_int(cfg.get("shadow_y", 0), 0)
    sc = str(cfg.get("shadow_color", "#000000")).strip() or "#000000"
    return f"{sx}px {sy}px 0 {sc}"

def css_stroke(cfg: dict) -> str:
    if not bool(cfg.get("stroke_enabled", False)):
        return ""
    sw = safe_int(cfg.get("stroke_width", 0), 0)
    sc = str(cfg.get("stroke_color", "#000000")).strip() or "#000000"
    if sw <= 0:
        return ""
    return f"-webkit-text-stroke:{sw}px {sc}; paint-order:stroke fill;"

def get_box(layout: dict, key: str) -> dict:
    cfg = dict(layout.get(key, {}))
    cfg.setdefault("x", 0)
    cfg.setdefault("y", 0)
    cfg.setdefault("w", 1)
    cfg.setdefault("h", 1)
    cfg.setdefault("visible", False)
    cfg.setdefault("font_family", "Arial")
    cfg.setdefault("font_weight", "400")
    cfg.setdefault("font_base", 40)
    cfg.setdefault("color", "#ffffff")
    cfg.setdefault("text_align", "center")
    cfg.setdefault("opacity", 1)
    cfg.setdefault("pad_x", 0)
    cfg.setdefault("pad_y", 0)
    cfg.setdefault("shadow_enabled", False)
    cfg.setdefault("shadow_x", 0)
    cfg.setdefault("shadow_y", 0)
    cfg.setdefault("shadow_color", "#000000")
    cfg.setdefault("stroke_enabled", False)
    cfg.setdefault("stroke_width", 0)
    cfg.setdefault("stroke_color", "#000000")
    cfg.setdefault("bg_enabled", False)
    cfg.setdefault("bg_color", "#000000")
    cfg.setdefault("bg_opacity", 1)
    cfg.setdefault("bg_radius", 0)
    cfg.setdefault("bg_pad_x", 0)
    cfg.setdefault("bg_pad_y", 0)
    cfg.setdefault("auto_size", False)
    cfg.setdefault("max_width", 0)
    cfg.setdefault("bg_image", "")
    return cfg

def make_text_div(key: str, text: str, cfg: dict) -> str:
    if not bool(cfg.get("visible", False)):
        return ""

    if not str(text or "").strip():
        return ""

    x = safe_int(cfg.get("x", 0), 0)
    y = safe_int(cfg.get("y", 0), 0)
    w = max(1, safe_int(cfg.get("w", 1), 1))
    h = max(1, safe_int(cfg.get("h", 1), 1))
    pad_x = max(0, safe_int(cfg.get("pad_x", 0), 0))
    pad_y = max(0, safe_int(cfg.get("pad_y", 0), 0))
    family = str(cfg.get("font_family", "Arial")).strip() or "Arial"
    weight = css_weight(cfg.get("font_weight", "400"))
    size = max(1, safe_int(cfg.get("font_base", 40), 40))
    color = str(cfg.get("color", "#ffffff")).strip() or "#ffffff"
    align = css_align(cfg.get("text_align", "center"))
    opacity = max(0.0, min(1.0, safe_float(cfg.get("opacity", 1), 1)))
    shadow = css_text_shadow(cfg)
    stroke = css_stroke(cfg)

    bg_enabled = bool(cfg.get("bg_enabled", False))
    bg_color = str(cfg.get("bg_color", "#000000")).strip() or "#000000"
    bg_opacity = max(0.0, min(1.0, safe_float(cfg.get("bg_opacity", 1), 1)))
    bg_radius = max(0, safe_int(cfg.get("bg_radius", 0), 0))
    bg_pad_x = max(0, safe_int(cfg.get("bg_pad_x", 0), 0))
    bg_pad_y = max(0, safe_int(cfg.get("bg_pad_y", 0), 0))
    auto_size = bool(cfg.get("auto_size", False))
    max_width = max(0, safe_int(cfg.get("max_width", 0), 0))

    justify = "center"
    if align == "left":
        justify = "flex-start"
    elif align == "right":
        justify = "flex-end"

    safe_text = esc(text).replace("\n", "<br>")

    width_css = f"{w}px"
    height_css = f"{h}px"
    display_css = "flex"
    white_space_css = "normal"
    overflow_css = "hidden"
    word_break_css = "break-word"
    extra_box_css = ""

    if auto_size:
        width_css = "max-content"
        height_css = "auto"
        display_css = "inline-flex"
        white_space_css = "pre-wrap"
        overflow_css = "visible"
        word_break_css = "break-word"
        if max_width > 0:
            width_css = f"fit-content"
            extra_box_css += f"max-width:{max_width}px;"

    bg_css = ""
    if bg_enabled:
        bg_image = str(cfg.get("bg_image", "")).strip()

        if bg_image:
            bg_css = f'background-image:url("{bg_image}");'
            bg_css += "background-size:100% 100%;"
            bg_css += "background-repeat:no-repeat;"
        else:
            bg_css = f"background:{bg_color};"

        bg_css += f"border-radius:{bg_radius}px;"
        bg_css += f"padding:{pad_y + bg_pad_y}px {pad_x + bg_pad_x}px;"
    else:
        bg_css = f"padding:{pad_y}px {pad_x}px;"

    return f"""
    <div class="txt txt-{esc(key)}" style="
        left:{x}px;
        top:{y}px;
        width:{width_css};
        height:{height_css};
        {bg_css}
        color:{color};
        font-family:'{esc(family)}', Arial, sans-serif;
        font-weight:{weight};
        font-size:{size}px;
        text-align:{align};
        opacity:{opacity};
        text-shadow:{shadow};
        {stroke}
        justify-content:{justify};
        display:{display_css};
        white-space:{white_space_css};
        overflow:{overflow_css};
        word-break:{word_break_css};
        box-sizing:border-box;
        line-height:1;
        align-items:center;
        {extra_box_css}
    ">{safe_text}</div>
    """

def build_html(layout: dict, pedido: dict) -> str:
    def box(key):
        return get_box(layout, key)

    def val(key, fallback=""):
        v = pedido.get(key, "")
        return str(v).strip() if v else fallback

    jogadores = pedido.get("jogadores", [])
    if isinstance(jogadores, str):
        try:
            jogadores = json.loads(jogadores)
        except Exception:
            jogadores = []

    jogadores_textos = {}
    for i in range(1, 23):
        texto = ""
        if jogadores and len(jogadores) >= i and isinstance(jogadores[i-1], dict):
            nome = str(jogadores[i-1].get("nome", "")).strip()
            posicao = str(jogadores[i-1].get("posicao", "")).strip()
            if nome and posicao:
                texto = f"{nome} - {posicao}"
            elif nome:
                texto = nome
            elif posicao:
                texto = posicao
        jogadores_textos[f"jogador_{i}"] = texto

    artilheiros = pedido.get("artilheiros", [])
    if isinstance(artilheiros, str):
        try:
            artilheiros = json.loads(artilheiros)
        except Exception:
            artilheiros = []

    artilheiros_txt = ""
    if artilheiros:
        linhas = []
        for a in artilheiros:
            if isinstance(a, dict):
                nome = str(a.get("nome", "")).strip()
                gols = str(a.get("gols", "")).strip()
                if nome:
                    linhas.append(f"{nome} ({gols})" if gols else nome)
        if linhas:
            artilheiros_txt = "Artilheiros:\n" + "\n".join(linhas)

    text_values = {
        "titulo": val("titulo", box("titulo").get("text", "TITULO")),
        "rodada_text": val("rodada", box("rodada_text").get("text", "")),
        "data_text": val("data"),
        "hora_text": val("hora"),
        "arena_text": val("arena"),
        "frase": val("frase"),
        "artilheiros": artilheiros_txt,
        "time_principal": val("time_principal"),
        "gols_time_principal": val("gols_time_principal"),
        "placar_x": box("placar_x").get("text", "X"),
        "gols_adversario": val("gols_adversario"),
        "time_adversario": val("time_adversario"),
    }

    divs = []

    for key, texto in text_values.items():
        div = make_text_div(key, texto, box(key))
        if div:
            divs.append(div)

    for i in range(1, 23):
        key = f"jogador_{i}"
        div = make_text_div(key, jogadores_textos.get(key, ""), box(key))
        if div:
            divs.append(div)

    return f"""<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Render Textos</title>
<meta name="viewport" content="width={W}, initial-scale=1.0">
<style>
html, body {{
    margin: 0;
    width: {W}px;
    height: {H}px;
    background: rgba(0,0,0,0) !important;
    overflow: visible;
}}
body {{
    font-synthesis: none;
    text-rendering: geometricPrecision;
    -webkit-font-smoothing: antialiased;
    background: rgba(0,0,0,0) !important;
}}
.canvas {{
    position: relative;
    width: {W}px;
    height: {H}px;
    background: transparent !important;
}}
.txt {{
    position: absolute;
    box-sizing: border-box;
    line-height: 1;
}}
</style>
</head>
<body>
<div class="canvas">
{''.join(divs)}
</div>
</body>
</html>
"""

def main():
    import sys

    if len(sys.argv) < 2:
        raise SystemExit("Uso: python render_textos_html.py <PASTA_DO_PEDIDO>")

    pedido_dir = Path(sys.argv[1]).resolve()
    if not pedido_dir.exists():
        raise SystemExit(f"Pasta não encontrada: {pedido_dir}")

    pedido_json = pedido_dir / "pedido.json"
    if not pedido_json.exists():
        raise SystemExit("pedido.json não encontrado")

    pedido = load_json(pedido_json)



    categoria = str(pedido.get("categoria", "")).strip().lower()
    if categoria == "escalacao":
        template_dir = BASE_DIR / "template_escalacao"
    elif categoria == "proximo_jogo":
        template_dir = BASE_DIR / "template_proximo_jogo"
    elif categoria == "patrocinador":
        template_dir = BASE_DIR / "template_patrocinador"
    else:
        template_dir = BASE_DIR / "template_resultado"

    layout_json = template_dir / "layout.json"
    if not layout_json.exists():
        raise SystemExit(f"layout.json não encontrado em {template_dir}")

    layout = load_json(layout_json)

    html_out = pedido_dir / "render_textos_teste.html"
    png_out = pedido_dir / "render_textos_teste.png"

    html_out.write_text(build_html(layout, pedido), encoding="utf-8")

    chrome = find_chrome()

    cmd = [
        str(chrome),
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--default-background-color=00000000",
        f"--screenshot={png_out}",
        f"--window-size={W},{H}",
        html_out.resolve().as_uri()
    ]

    print("Renderizando HTML automático...")
    print("HTML:", html_out)
    print("PNG:", png_out)
    print("Chrome:", chrome)

    result = subprocess.run(cmd, capture_output=True, text=True)

    print(result.stdout)
    print(result.stderr)

    if result.returncode != 0:
        raise RuntimeError("Chrome headless falhou ao gerar o PNG.")

    if not png_out.exists():
        raise RuntimeError("PNG final não foi criado.")

    print(f"OK: {png_out}")

if __name__ == "__main__":
    main()












