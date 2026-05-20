import json
import base64
import shutil
import subprocess
import mimetypes
from pathlib import Path
from collections import Counter

import requests
from PIL import Image, ImageFont, ImageDraw

# =========================================================
# CONFIG
# =========================================================
BASE_DIR = Path(__file__).resolve().parent
TEMPLATE_DIR = BASE_DIR / "template_resultado"
OUT_DIR = BASE_DIR / "resultados_prontos"
OUT_DIR.mkdir(exist_ok=True)

OPENAI_KEY_FILE = BASE_DIR / "openai_key.txt"
CREDENTIALS_FILE = BASE_DIR / "credenciais.txt"

OPENAI_URL = "https://api.openai.com/v1/responses"
OPENAI_MODEL = "gpt-4.1-mini"

FFMPEG_BIN = "ffmpeg"

W = 1080
H = 1920

FONT_BOLD = r"C\:/Windows/Fonts/arialbd.ttf"
FONT_REG = r"C\:/Windows/Fonts/arial.ttf"

# =========================================================
# HELPERS
# =========================================================
def log(msg: str):
    print(msg, flush=True)

def ffmpeg_escape(text: str) -> str:
    if text is None:
        return ""
    text = str(text)
    text = text.replace("\\", "\\\\")
    text = text.replace(":", r"\:")
    text = text.replace("'", r"\'")
    text = text.replace("%", r"\%")
    text = text.replace(",", r"\,")
    text = text.replace("[", r"\[")
    text = text.replace("]", r"\]")
    text = text.replace("\n", r"\n")
    return text

def find_existing(folder: Path, names: list[str]) -> Path | None:
    for name in names:
        p = folder / name
        if p.exists():
            return p
    return None

def optional_template_file(folder: Path, names: list[str]) -> Path | None:
    for name in names:
        p = folder / name
        if p.exists():
            return p
    return None

def load_json(p: Path) -> dict:
    return json.loads(p.read_text(encoding="utf-8"))

def load_api_key() -> str:
    if not OPENAI_KEY_FILE.exists():
        raise FileNotFoundError(f"Não achei {OPENAI_KEY_FILE.name} na mesma pasta do script.")
    key = OPENAI_KEY_FILE.read_text(encoding="utf-8", errors="ignore").strip()
    if not key:
        raise ValueError(f"{OPENAI_KEY_FILE.name} está vazio.")
    return key

def load_credentials() -> tuple[str, str]:
    if not CREDENTIALS_FILE.exists():
        raise FileNotFoundError("credenciais.txt não encontrado na mesma pasta do script.")

    linhas = CREDENTIALS_FILE.read_text(encoding="utf-8", errors="ignore").splitlines()
    if len(linhas) < 2:
        raise ValueError("credenciais.txt inválido. Use linha 1 = whatsapp, linha 2 = senha.")

    whatsapp = linhas[0].strip()
    senha = linhas[1].strip()

    if not whatsapp or not senha:
        raise ValueError("credenciais.txt inválido. WhatsApp ou senha vazios.")

    return whatsapp, senha

def rgb_to_hex(rgb):
    return "#{:02x}{:02x}{:02x}".format(*rgb)

def hex_to_rgb(hx: str):
    hx = hx.strip().lstrip("#")
    if len(hx) != 6:
        raise ValueError(f"HEX inválido: {hx}")
    return tuple(int(hx[i:i+2], 16) for i in (0, 2, 4))

def luminance(rgb):
    r, g, b = rgb
    return 0.2126 * r + 0.7152 * g + 0.0722 * b

def choose_text_color(bg_rgb):
    return (255, 255, 255) if luminance(bg_rgb) < 150 else (15, 20, 30)

def ensure_template_files():
    layout_file = TEMPLATE_DIR / "layout.json"
    if not layout_file.exists():
        raise FileNotFoundError("layout.json não encontrado em template_resultado")

def run_ffmpeg(cmd: list[str]):
    log("Rodando FFmpeg...")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(result.stdout)
        print(result.stderr)
        raise RuntimeError("FFmpeg falhou.")

def image_to_data_url(img_path: Path) -> str:
    mime, _ = mimetypes.guess_type(str(img_path))
    if not mime:
        mime = "image/png"
    b64 = base64.b64encode(img_path.read_bytes()).decode("utf-8")
    return f"data:{mime};base64,{b64}"

def extract_json_from_text(text: str) -> dict:
    text = text.strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("Não encontrei JSON válido na resposta da API.")
    raw = text[start:end + 1]
    return json.loads(raw)

def load_font(font_path: str, size: int):
    try:
        return ImageFont.truetype(font_path, size=size)
    except Exception:
        return ImageFont.load_default()

def measure_text_block(text: str, font_path: str, font_size: int, line_spacing: int = 8) -> tuple[int, int]:
    text = text or ""
    font = load_font(font_path, font_size)
    dummy = Image.new("RGBA", (10, 10), (0, 0, 0, 0))
    draw = ImageDraw.Draw(dummy)
    bbox = draw.multiline_textbbox((0, 0), text, font=font, spacing=line_spacing, align="center")
    w = max(1, bbox[2] - bbox[0])
    h = max(1, bbox[3] - bbox[1])
    return w, h

def wrap_text_pixel(text: str, font_path: str, font_size: int, max_width: int, max_lines: int) -> str:
    text = " ".join((text or "").split())
    if not text:
        return ""

    words = text.split(" ")
    lines = []
    current = ""

    for word in words:
        test = word if not current else f"{current} {word}"
        test_w, _ = measure_text_block(test, font_path, font_size)
        if test_w <= max_width:
            current = test
        else:
            if current:
                lines.append(current)
                current = word
            else:
                current = word

            if len(lines) >= max_lines:
                break

    if current and len(lines) < max_lines:
        lines.append(current)

    if not lines:
        return text

    used_words = sum(len(line.split()) for line in lines)
    if used_words < len(words):
        remaining = words[used_words:]
        if remaining:
            last = lines[-1]
            candidate = f"{last} {' '.join(remaining)}"
            lines[-1] = candidate

    return "\n".join(lines)

def fit_wrapped_text(text: str, font_path: str, start_size: int, min_size: int, max_width: int, max_lines: int, line_spacing: int = 8):
    size = start_size
    chosen_text = " ".join((text or "").split()) or ""

    while size >= min_size:
        wrapped = wrap_text_pixel(chosen_text, font_path, size, max_width, max_lines)
        w, h = measure_text_block(wrapped, font_path, size, line_spacing=line_spacing)
        lines_count = wrapped.count("\n") + 1 if wrapped else 1

        if w <= max_width and lines_count <= max_lines:
            return {
                "text": wrapped,
                "font_size": size,
                "text_w": w,
                "text_h": h,
                "lines": lines_count,
                "line_spacing": line_spacing,
            }
        size -= 1

    wrapped = wrap_text_pixel(chosen_text, font_path, min_size, max_width, max_lines)
    w, h = measure_text_block(wrapped, font_path, min_size, line_spacing=line_spacing)
    return {
        "text": wrapped,
        "font_size": min_size,
        "text_w": w,
        "text_h": h,
        "lines": wrapped.count("\n") + 1 if wrapped else 1,
        "line_spacing": line_spacing,
    }

def fit_block_text(text: str, font_path: str, cfg: dict, default_max_lines: int = 1, line_spacing: int = 6):
    font_base = int(cfg.get("font_base", 48))
    font_min = int(cfg.get("font_min", 20))
    max_lines = int(cfg.get("max_lines", default_max_lines))
    max_width = max(40, int(cfg.get("w", 200)) - (int(cfg.get("pad_x", 0)) * 2))
    return fit_wrapped_text(
        text=text,
        font_path=font_path,
        start_size=font_base,
        min_size=font_min,
        max_width=max_width,
        max_lines=max_lines,
        line_spacing=line_spacing,
    )

def drawtext_block(text: str, font_path: str, font_size: int, color_hex: str, x_expr: str, y_expr: str, line_spacing: int = 6, alpha: str = "") -> str:
    alpha_suffix = alpha if alpha else ""
    return (
        f"drawtext=fontfile='{font_path}':text='{ffmpeg_escape(text)}':"
        f"fontcolor={color_hex}{alpha_suffix}:"
        f"fontsize={font_size}:"
        f"x={x_expr}:"
        f"y={y_expr}:"
        f"line_spacing={line_spacing}"
    )

def box_x_expr(x: int, w: int, align: str = "center", pad: int = 0) -> str:
    align = (align or "center").strip().lower()
    if align == "left":
        return f"{x}+{pad}"
    if align == "right":
        return f"{x}+{w}-text_w-{pad}"
    return f"{x}+({w}-text_w)/2"

def box_y_expr(y: int, h: int) -> str:
    return f"{y}+({h}-text_h)/2"

# =========================================================
# LAYOUT JSON
# =========================================================
def apply_text_defaults(layout: dict, key: str, defaults: dict):
    layout.setdefault(key, {})
    for k, v in defaults.items():
        layout[key].setdefault(k, v)

def load_layout(template_dir: Path) -> dict:
    layout_file = template_dir / "layout.json"
    if not layout_file.exists():
        raise FileNotFoundError(f"layout.json não encontrado em: {template_dir}")
    layout = load_json(layout_file)

    layout.setdefault("safe_margin_x", 22)

    layout.setdefault("moldura", {})
    layout["moldura"].setdefault("x", 0)
    layout["moldura"].setdefault("y", 0)
    layout["moldura"].setdefault("visible", True)

    layout.setdefault("logo", {})
    layout["logo"].setdefault("x", 30)
    layout["logo"].setdefault("y", 22)
    layout["logo"].setdefault("w", 350)
    layout["logo"].setdefault("h", 0)
    layout["logo"].setdefault("gap_right", 16)
    layout["logo"].setdefault("visible", True)

    layout.setdefault("topo", {})
    layout["topo"].setdefault("x", 396)
    layout["topo"].setdefault("y", 22)
    layout["topo"].setdefault("base_w", 620)
    layout["topo"].setdefault("base_h", 112)
    layout["topo"].setdefault("pad_x", 28)
    layout["topo"].setdefault("pad_y", 18)
    layout["topo"].setdefault("visible", True)

    layout.setdefault("faixa_principal", {})
    layout["faixa_principal"].setdefault("x", 80)
    layout["faixa_principal"].setdefault("y", 1215)
    layout["faixa_principal"].setdefault("base_w", 920)
    layout["faixa_principal"].setdefault("base_h", 132)
    layout["faixa_principal"].setdefault("pad_x", 50)
    layout["faixa_principal"].setdefault("pad_y", 18)
    layout["faixa_principal"].setdefault("visible", True)

    layout.setdefault("faixa_secundaria", {})
    layout["faixa_secundaria"].setdefault("x", 160)
    layout["faixa_secundaria"].setdefault("y", 1375)
    layout["faixa_secundaria"].setdefault("base_w", 760)
    layout["faixa_secundaria"].setdefault("base_h", 94)
    layout["faixa_secundaria"].setdefault("pad_x", 40)
    layout["faixa_secundaria"].setdefault("pad_y", 18)
    layout["faixa_secundaria"].setdefault("visible", True)

    apply_text_defaults(layout, "time_principal", {
        "x": 414, "y": 40, "w": 250, "h": 46,
        "font_base": 34, "font_min": 20, "max_lines": 2,
        "align": "center", "visible": True, "color": "#ffffff",
        "pad_x": 0, "pad_y": 0, "opacity": 1.0
    })
    apply_text_defaults(layout, "gols_time_principal", {
        "x": 670, "y": 32, "w": 78, "h": 60,
        "font_base": 56, "font_min": 28, "max_lines": 1,
        "align": "center", "visible": True, "color": "#ffffff",
        "pad_x": 0, "pad_y": 0, "opacity": 1.0
    })
    apply_text_defaults(layout, "placar_x", {
        "x": 754, "y": 34, "w": 44, "h": 56,
        "text": "X", "font_base": 48, "font_min": 24, "max_lines": 1,
        "align": "center", "visible": True, "color": "#ffffff",
        "pad_x": 0, "pad_y": 0, "opacity": 1.0
    })
    apply_text_defaults(layout, "gols_adversario", {
        "x": 804, "y": 32, "w": 78, "h": 60,
        "font_base": 56, "font_min": 28, "max_lines": 1,
        "align": "center", "visible": True, "color": "#ffffff",
        "pad_x": 0, "pad_y": 0, "opacity": 1.0
    })
    apply_text_defaults(layout, "time_adversario", {
        "x": 888, "y": 40, "w": 110, "h": 46,
        "font_base": 34, "font_min": 20, "max_lines": 2,
        "align": "center", "visible": True, "color": "#ffffff",
        "pad_x": 0, "pad_y": 0, "opacity": 1.0
    })
    apply_text_defaults(layout, "titulo", {
        "x": 80, "y": 1215, "w": 920, "h": 132,
        "text": "RESULTADO FINAL",
        "font_base": 72, "font_min": 50, "max_lines": 2,
        "align": "center", "visible": True, "color": "#ffffff",
        "pad_x": 0, "pad_y": 0, "opacity": 1.0
    })
    apply_text_defaults(layout, "frase", {
        "x": 160, "y": 1375, "w": 760, "h": 94,
        "font_base": 30, "font_min": 20, "max_lines": 3,
        "align": "center", "visible": True, "color": "#ffffff",
        "pad_x": 0, "pad_y": 0, "opacity": 1.0
    })
    apply_text_defaults(layout, "artilheiros", {
        "x": 170, "y": 1498, "w": 740, "h": 120,
        "font_base": 28, "font_min": 18, "max_lines": 4,
        "align": "center", "visible": True, "color": "#ffffff",
        "pad_x": 0, "pad_y": 0, "opacity": 1.0
    })

    layout.setdefault("bg", {})
    layout["bg"].setdefault("brightness", 0.0)
    layout["bg"].setdefault("saturation", 1.0)
    layout["bg"].setdefault("contrast", 1.0)

    return layout

# =========================================================
# CORES
# =========================================================
def is_neutral_color(rgb, sat_min=35, lum_min=35, lum_max=220):
    r, g, b = rgb
    mx = max(rgb)
    mn = min(rgb)
    sat = mx - mn
    lum = (r + g + b) / 3
    return sat < sat_min or lum < lum_min or lum > lum_max

def force_non_neutral_palette(primary, secondary):
    if is_neutral_color(primary):
        primary = (180, 30, 30)
    if is_neutral_color(secondary):
        secondary = (20, 90, 60)

    if primary == secondary:
        secondary = (20, 90, 60) if primary != (20, 90, 60) else (180, 30, 30)

    return primary, secondary

# =========================================================
# FALLBACK LOCAL
# =========================================================
def extract_main_colors_local(crest_path: Path):
    img = Image.open(crest_path).convert("RGBA")
    img.thumbnail((250, 250))

    pixels = []
    for r, g, b, a in img.getdata():
        if a < 40:
            continue
        rgb = (r, g, b)
        if is_neutral_color(rgb):
            continue
        pixels.append(rgb)

    if not pixels:
        primary = (180, 30, 30)
        secondary = (20, 90, 60)
        return {
            "primary": primary,
            "secondary": secondary,
            "text_on_primary": choose_text_color(primary),
            "text_on_secondary": choose_text_color(secondary),
        }

    counter = Counter(pixels).most_common(500)
    primary = counter[0][0]

    def dist(c1, c2):
        return sum((a - b) ** 2 for a, b in zip(c1, c2))

    secondary = primary
    best_d = -1
    for color, _ in counter[1:]:
        if is_neutral_color(color):
            continue
        d = dist(primary, color)
        if d > best_d:
            best_d = d
            secondary = color

    primary, secondary = force_non_neutral_palette(primary, secondary)

    return {
        "primary": primary,
        "secondary": secondary,
        "text_on_primary": choose_text_color(primary),
        "text_on_secondary": choose_text_color(secondary),
    }

# =========================================================
# OPENAI - PALETA
# =========================================================
def get_palette_from_openai(crest_path: Path, team_name: str = "") -> dict:
    api_key = load_api_key()
    image_data_url = image_to_data_url(crest_path)

    prompt = f"""
Analise SOMENTE o escudo enviado e devolva APENAS um JSON puro.

Objetivo:
definir cores fortes para arte esportiva pós-jogo.

REGRAS OBRIGATÓRIAS:
- NÃO usar branco, cinza, preto ou tons neutros como cor principal;
- NÃO usar branco, cinza, preto ou tons neutros como cor secundária;
- escolher cores vivas e profissionais que realmente representem o escudo;
- priorizar tons mais marcantes e saturados do escudo;
- pensar em design premium de futebol.

Nome do time (apenas contexto): {team_name or "não informado"}

Formato EXATO:
{{
  "primary_hex": "#112233",
  "secondary_hex": "#445566",
  "text_on_primary_hex": "#FFFFFF",
  "text_on_secondary_hex": "#0F141E"
}}
""".strip()

    payload = {
        "model": OPENAI_MODEL,
        "input": [
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": prompt},
                    {"type": "input_image", "image_url": image_data_url, "detail": "high"},
                ]
            }
        ]
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    log("Consultando OpenAI para definir paleta...")
    resp = requests.post(OPENAI_URL, headers=headers, json=payload, timeout=180)

    if resp.status_code != 200:
        raise RuntimeError(f"OpenAI HTTP {resp.status_code}: {resp.text[:1000]}")

    data = resp.json()

    text_out = data.get("output_text", "").strip()
    if not text_out:
        collected = []
        for item in data.get("output", []):
            for content in item.get("content", []):
                if content.get("type") in ("output_text", "text"):
                    if content.get("text"):
                        collected.append(content["text"])
        text_out = "\n".join(collected).strip()

    if not text_out:
        raise RuntimeError("A API respondeu, mas não trouxe texto com a paleta.")

    parsed = extract_json_from_text(text_out)

    primary = hex_to_rgb(parsed["primary_hex"])
    secondary = hex_to_rgb(parsed["secondary_hex"])

    primary, secondary = force_non_neutral_palette(primary, secondary)

    text_on_primary = choose_text_color(primary)
    text_on_secondary = choose_text_color(secondary)

    return {
        "primary": primary,
        "secondary": secondary,
        "text_on_primary": text_on_primary,
        "text_on_secondary": text_on_secondary,
        "raw": parsed,
    }

# =========================================================
# TINT
# =========================================================
def tint_template(src: Path, dst: Path, color_rgb, strength=1.0, min_alpha_keep=20):
    img = Image.open(src).convert("RGBA")
    r_t, g_t, b_t = color_rgb

    px_out = []
    for r, g, b, a in img.getdata():
        if a < min_alpha_keep:
            px_out.append((0, 0, 0, 0))
            continue

        gray = (r + g + b) / 3.0 / 255.0
        nr = int(r_t * gray * strength)
        ng = int(g_t * gray * strength)
        nb = int(b_t * gray * strength)

        nr = max(0, min(255, nr))
        ng = max(0, min(255, ng))
        nb = max(0, min(255, nb))

        px_out.append((nr, ng, nb, a))

    out = Image.new("RGBA", img.size)
    out.putdata(px_out)
    out.save(dst)

def upload_resultado_para_site(pedido_dir: Path, pedido_id: str, imagem_path: Path):
    pedido_json = pedido_dir / "pedido.json"
    if not pedido_json.exists():
        raise FileNotFoundError("pedido.json não encontrado para upload do resultado")

    pedido = load_json(pedido_json)
    whatsapp = str(pedido.get("whatsapp", "")).strip()

    if not whatsapp:
        raise ValueError("whatsapp não encontrado no pedido.json")

    whatsapp_login, senha_login = load_credentials()

    login_resp = requests.post(
        "https://api.omascote.com.br/auth/login",
        json={
            "whatsapp": whatsapp_login,
            "senha": senha_login
        },
        timeout=60
    )

    if login_resp.status_code != 200:
        raise RuntimeError(f"Falha no login da API: {login_resp.status_code} | {login_resp.text[:500]}")

    login_data = login_resp.json()
    token = login_data.get("token", "").strip()

    if not token:
        raise RuntimeError("Login da API não retornou token")

    with open(imagem_path, "rb") as f:
        up_resp = requests.post(
            f"https://api.omascote.com.br/pedidos/{pedido_id}/upload-resultado",
            headers={
                "Authorization": f"Bearer {token}"
            },
            files={
                "resultado": ("resultado_final.png", f, "image/png")
            },
            timeout=120
        )

    if up_resp.status_code != 200:
        raise RuntimeError(f"Falha ao enviar resultado: {up_resp.status_code} | {up_resp.text[:500]}")

    log("✅ Resultado enviado para o site com sucesso")

# =========================================================
# MAIN
# =========================================================
def main():
    import sys

    if len(sys.argv) < 2:
        raise SystemExit("Uso: python resultado_pipeline.py <PASTA_DO_PEDIDO>")

    pedido_dir = Path(sys.argv[1]).resolve()
    if not pedido_dir.exists():
        raise SystemExit(f"Pasta não encontrada: {pedido_dir}")

    ensure_template_files()
    layout = load_layout(TEMPLATE_DIR)

    pedido_json = pedido_dir / "pedido.json"
    if not pedido_json.exists():
        raise SystemExit("pedido.json não encontrado")

    pedido = load_json(pedido_json)

    foto_jogo = find_existing(
        pedido_dir,
        ["escudo1.png", "escudo1.jpg", "escudo1.jpeg", "escudo1.webp"]
    )
    escudo = find_existing(
        pedido_dir,
        ["escudo2.png", "escudo2.jpg", "escudo2.jpeg", "escudo2.webp"]
    )

    if not foto_jogo:
        raise SystemExit("Imagem do jogo não encontrada (escudo1.*)")
    if not escudo:
        raise SystemExit("Escudo não encontrado (escudo2.*)")

    time_principal = str(pedido.get("time_principal", "")).strip()
    gols_time = int(pedido.get("gols_time_principal", 0))
    gols_adv = int(pedido.get("gols_adversario", 0))
    time_adv = str(pedido.get("time_adversario", "")).strip()

    resultado = str(pedido.get("rodada", "")).strip()
    use_split_score = bool(time_principal or time_adv or gols_time or gols_adv)

    if use_split_score:
        if time_principal and time_adv:
            resultado = f"{time_principal} {gols_time} x {gols_adv} {time_adv}"
        elif time_principal:
            resultado = f"{time_principal} {gols_time} x {gols_adv}"
        else:
            resultado = f"{gols_time} x {gols_adv}"

    frase = str(pedido.get("data", "")).strip()
    nome_time = str(pedido.get("nome_time", "")).strip()
    pedido_id = str(pedido.get("id", "sem_id")).strip()

    artilheiros_raw = pedido.get("artilheiros", "[]")

    try:
        if isinstance(artilheiros_raw, str):
            artilheiros = json.loads(artilheiros_raw)
        elif isinstance(artilheiros_raw, list):
            artilheiros = artilheiros_raw
        else:
            artilheiros = []
    except Exception:
        artilheiros = []

    artilheiros_linhas = []
    for a in artilheiros:
        if not isinstance(a, dict):
            continue
        nome_art = str(a.get("nome", "")).strip()
        gols_art = str(a.get("gols", "")).strip()
        if not nome_art:
            continue
        if gols_art:
            artilheiros_linhas.append(f"{nome_art} ({gols_art})")
        else:
            artilheiros_linhas.append(nome_art)

    artilheiros_texto = ""
    if artilheiros_linhas:
        artilheiros_texto = "Artilheiros: " + " | ".join(artilheiros_linhas)

    try:
        palette = get_palette_from_openai(escudo, team_name=nome_time)
        cor_primaria = palette["primary"]
        cor_secundaria = palette["secondary"]
        cor_texto = palette["text_on_primary"]
        cor_texto_sec = palette["text_on_secondary"]
        palette_source = "openai"
    except Exception as e:
        log(f"⚠️ OpenAI falhou, usando fallback local: {e}")
        palette = extract_main_colors_local(escudo)
        cor_primaria = palette["primary"]
        cor_secundaria = palette["secondary"]
        cor_texto = palette["text_on_primary"]
        cor_texto_sec = palette["text_on_secondary"]
        palette_source = "local"

    log(f"Paleta origem: {palette_source}")
    log(f"Cor primária: {cor_primaria} {rgb_to_hex(cor_primaria)}")
    log(f"Cor secundária: {cor_secundaria} {rgb_to_hex(cor_secundaria)}")
    log(f"Texto sobre primária: {cor_texto} {rgb_to_hex(cor_texto)}")
    log(f"Texto sobre secundária: {cor_texto_sec} {rgb_to_hex(cor_texto_sec)}")

    temp_dir = pedido_dir / "_resultado_temp"
    if temp_dir.exists():
        shutil.rmtree(temp_dir)
    temp_dir.mkdir(parents=True, exist_ok=True)

    moldura_src = optional_template_file(TEMPLATE_DIR, ["moldura.png"])
    topo_src = optional_template_file(TEMPLATE_DIR, ["topo_barra.png", "topo.png"])
    faixa1_src = optional_template_file(TEMPLATE_DIR, ["faixa_principal.png"])
    faixa2_src = optional_template_file(TEMPLATE_DIR, ["faixa_secundaria.png"])

    moldura_t = temp_dir / "moldura_t.png"
    topo_t = temp_dir / "topo_t.png"
    faixa1_t = temp_dir / "faixa1_t.png"
    faixa2_t = temp_dir / "faixa2_t.png"

    if moldura_src:
        tint_template(moldura_src, moldura_t, cor_secundaria, strength=1.35)
    if topo_src:
        tint_template(topo_src, topo_t, cor_secundaria, strength=1.35)
    if faixa1_src:
        tint_template(faixa1_src, faixa1_t, cor_primaria, strength=1.45)
    if faixa2_src:
        tint_template(faixa2_src, faixa2_t, cor_secundaria, strength=1.45)

    out_final_pedido = pedido_dir / "resultado_final.png"
    out_final_geral = OUT_DIR / f"resultado_{pedido_id}.png"

    # =====================================================
    # LAYOUT SOBERANO
    # =====================================================
    SAFE_MARGIN_X = int(layout["safe_margin_x"])

    MOLDURA_X = int(layout["moldura"]["x"])
    MOLDURA_Y = int(layout["moldura"]["y"])

    LOGO_CFG = layout["logo"]
    LOGO_X = int(LOGO_CFG["x"])
    LOGO_Y = int(LOGO_CFG["y"])
    LOGO_W = int(LOGO_CFG["w"])
    LOGO_VISIBLE = bool(LOGO_CFG.get("visible", True))

    TOPO_CFG = layout["topo"]
    TOPO_BOX_X = int(TOPO_CFG["x"])
    TOPO_BOX_Y = int(TOPO_CFG["y"])
    TOPO_BOX_W = int(TOPO_CFG["base_w"])
    TOPO_BOX_H = int(TOPO_CFG["base_h"])

    FAIXA1_CFG = layout["faixa_principal"]
    FAIXA1_X = int(FAIXA1_CFG["x"])
    FAIXA1_Y = int(FAIXA1_CFG["y"])
    FAIXA1_W = int(FAIXA1_CFG["base_w"])
    FAIXA1_H = int(FAIXA1_CFG["base_h"])

    FAIXA2_CFG = layout["faixa_secundaria"]
    FAIXA2_X = int(FAIXA2_CFG["x"])
    FAIXA2_Y = int(FAIXA2_CFG["y"])
    FAIXA2_W = int(FAIXA2_CFG["base_w"])
    FAIXA2_H = int(FAIXA2_CFG["base_h"])

    BG_BRIGHTNESS = float(layout["bg"]["brightness"])
    BG_SATURATION = float(layout["bg"]["saturation"])
    BG_CONTRAST = float(layout["bg"]["contrast"])

    TIME_PRINCIPAL_CFG = layout["time_principal"]
    GOLS_TIME_CFG = layout["gols_time_principal"]
    PLACAR_X_CFG = layout["placar_x"]
    GOLS_ADV_CFG = layout["gols_adversario"]
    TIME_ADV_CFG = layout["time_adversario"]
    TITULO_CFG = layout["titulo"]
    FRASE_CFG = layout["frase"]
    ARTILHEIROS_CFG = layout["artilheiros"]

    # =====================================================
    # FIT DOS TEXTOS DENTRO DAS CAIXAS
    # =====================================================
    tp_fit = fit_block_text(time_principal, FONT_BOLD, TIME_PRINCIPAL_CFG, default_max_lines=2, line_spacing=6)
    gt_fit = fit_block_text(str(gols_time), FONT_BOLD, GOLS_TIME_CFG, default_max_lines=1, line_spacing=4)
    px_fit = fit_block_text(str(PLACAR_X_CFG.get("text", "x")), FONT_BOLD, PLACAR_X_CFG, default_max_lines=1, line_spacing=4)
    ga_fit = fit_block_text(str(gols_adv), FONT_BOLD, GOLS_ADV_CFG, default_max_lines=1, line_spacing=4)
    ta_fit = fit_block_text(time_adv, FONT_BOLD, TIME_ADV_CFG, default_max_lines=2, line_spacing=6)

    titulo_text_final = str(TITULO_CFG.get("text", "RESULTADO FINAL"))
    titulo_fit = fit_block_text(titulo_text_final, FONT_BOLD, TITULO_CFG, default_max_lines=int(TITULO_CFG.get("max_lines", 2)), line_spacing=8)

    frase_text_final = frase if frase else str(FRASE_CFG.get("text", ""))
    frase_fit = fit_block_text(frase_text_final, FONT_BOLD, FRASE_CFG, default_max_lines=int(FRASE_CFG.get("max_lines", 3)), line_spacing=8)

    artilheiros_text_final = artilheiros_texto if artilheiros_texto else str(ARTILHEIROS_CFG.get("text", ""))
    artilheiros_fit = fit_block_text(artilheiros_text_final, FONT_REG, ARTILHEIROS_CFG, default_max_lines=int(ARTILHEIROS_CFG.get("max_lines", 4)), line_spacing=6)

    placar_fit = fit_wrapped_text(
        resultado,
        FONT_BOLD,
        int(layout.get("placar", {}).get("font_base", 62)),
        int(layout.get("placar", {}).get("font_min", 40)),
        max(120, TOPO_BOX_W - (int(TOPO_CFG.get("pad_x", 0)) * 2)),
        int(layout.get("placar", {}).get("max_lines", 2)),
        line_spacing=6,
    )

    nome_time_fit = fit_wrapped_text(
        nome_time,
        FONT_REG,
        int(layout.get("nome_time", {}).get("font_base", 22)),
        int(layout.get("nome_time", {}).get("font_min", 16)),
        max(100, TOPO_BOX_W - 36),
        1,
        line_spacing=4,
    )

    logo_img = Image.open(escudo).convert("RGBA")
    logo_h_original = logo_img.size[1]
    logo_w_original = logo_img.size[0]

    LOGO_H = max(1, int(round(logo_h_original * (LOGO_W / logo_w_original)))) if logo_w_original > 0 else LOGO_W

    # =====================================================
    # DRAWTEXTS - LAYOUT SOBERANO
    # =====================================================
    draw_ops = []

    if use_split_score:
        if TIME_PRINCIPAL_CFG.get("visible", True) and tp_fit["text"]:
            draw_ops.append(drawtext_block(
                text=tp_fit["text"],
                font_path=FONT_BOLD,
                font_size=tp_fit["font_size"],
                color_hex=str(TIME_PRINCIPAL_CFG.get("color", rgb_to_hex(cor_texto_sec))),
                x_expr=box_x_expr(
                    int(TIME_PRINCIPAL_CFG["x"]),
                    int(TIME_PRINCIPAL_CFG["w"]),
                    TIME_PRINCIPAL_CFG.get("align", "center"),
                    int(TIME_PRINCIPAL_CFG.get("pad_x", 0))
                ),
                y_expr=box_y_expr(int(TIME_PRINCIPAL_CFG["y"]), int(TIME_PRINCIPAL_CFG["h"])),
                line_spacing=tp_fit["line_spacing"],
            ))

        if GOLS_TIME_CFG.get("visible", True) and gt_fit["text"]:
            draw_ops.append(drawtext_block(
                text=gt_fit["text"],
                font_path=FONT_BOLD,
                font_size=gt_fit["font_size"],
                color_hex=str(GOLS_TIME_CFG.get("color", rgb_to_hex(cor_texto_sec))),
                x_expr=box_x_expr(
                    int(GOLS_TIME_CFG["x"]),
                    int(GOLS_TIME_CFG["w"]),
                    GOLS_TIME_CFG.get("align", "center"),
                    int(GOLS_TIME_CFG.get("pad_x", 0))
                ),
                y_expr=box_y_expr(int(GOLS_TIME_CFG["y"]), int(GOLS_TIME_CFG["h"])),
                line_spacing=gt_fit["line_spacing"],
            ))

        if PLACAR_X_CFG.get("visible", True) and px_fit["text"]:
            draw_ops.append(drawtext_block(
                text=px_fit["text"],
                font_path=FONT_BOLD,
                font_size=px_fit["font_size"],
                color_hex=str(PLACAR_X_CFG.get("color", rgb_to_hex(cor_texto_sec))),
                x_expr=box_x_expr(
                    int(PLACAR_X_CFG["x"]),
                    int(PLACAR_X_CFG["w"]),
                    PLACAR_X_CFG.get("align", "center"),
                    int(PLACAR_X_CFG.get("pad_x", 0))
                ),
                y_expr=box_y_expr(int(PLACAR_X_CFG["y"]), int(PLACAR_X_CFG["h"])),
                line_spacing=px_fit["line_spacing"],
            ))

        if GOLS_ADV_CFG.get("visible", True) and ga_fit["text"]:
            draw_ops.append(drawtext_block(
                text=ga_fit["text"],
                font_path=FONT_BOLD,
                font_size=ga_fit["font_size"],
                color_hex=str(GOLS_ADV_CFG.get("color", rgb_to_hex(cor_texto_sec))),
                x_expr=box_x_expr(
                    int(GOLS_ADV_CFG["x"]),
                    int(GOLS_ADV_CFG["w"]),
                    GOLS_ADV_CFG.get("align", "center"),
                    int(GOLS_ADV_CFG.get("pad_x", 0))
                ),
                y_expr=box_y_expr(int(GOLS_ADV_CFG["y"]), int(GOLS_ADV_CFG["h"])),
                line_spacing=ga_fit["line_spacing"],
            ))

        if TIME_ADV_CFG.get("visible", True) and ta_fit["text"]:
            draw_ops.append(drawtext_block(
                text=ta_fit["text"],
                font_path=FONT_BOLD,
                font_size=ta_fit["font_size"],
                color_hex=str(TIME_ADV_CFG.get("color", rgb_to_hex(cor_texto_sec))),
                x_expr=box_x_expr(
                    int(TIME_ADV_CFG["x"]),
                    int(TIME_ADV_CFG["w"]),
                    TIME_ADV_CFG.get("align", "center"),
                    int(TIME_ADV_CFG.get("pad_x", 0))
                ),
                y_expr=box_y_expr(int(TIME_ADV_CFG["y"]), int(TIME_ADV_CFG["h"])),
                line_spacing=ta_fit["line_spacing"],
            ))
    else:
        if layout.get("placar", {}).get("visible", True):
            draw_ops.append(drawtext_block(
                text=placar_fit["text"],
                font_path=FONT_BOLD,
                font_size=placar_fit["font_size"],
                color_hex=rgb_to_hex(cor_texto_sec),
                x_expr=box_x_expr(TOPO_BOX_X, TOPO_BOX_W, "center", int(TOPO_CFG.get("pad_x", 0))),
                y_expr=box_y_expr(TOPO_BOX_Y, TOPO_BOX_H),
                line_spacing=placar_fit["line_spacing"],
            ))

        if nome_time_fit["text"] and layout.get("nome_time", {}).get("visible", True):
            draw_ops.append(drawtext_block(
                text=nome_time_fit["text"],
                font_path=FONT_REG,
                font_size=nome_time_fit["font_size"],
                color_hex=rgb_to_hex(cor_texto_sec),
                x_expr=f"{TOPO_BOX_X}+18",
                y_expr=f"{TOPO_BOX_Y}+6",
                line_spacing=4,
                alpha="@0.18",
            ))

    if TITULO_CFG.get("visible", True) and titulo_fit["text"]:
        draw_ops.append(drawtext_block(
            text=titulo_fit["text"],
            font_path=FONT_BOLD,
            font_size=titulo_fit["font_size"],
            color_hex=str(TITULO_CFG.get("color", rgb_to_hex(cor_texto))),
            x_expr=box_x_expr(
                int(TITULO_CFG["x"]),
                int(TITULO_CFG["w"]),
                TITULO_CFG.get("align", "center"),
                int(TITULO_CFG.get("pad_x", 0))
            ),
            y_expr=box_y_expr(int(TITULO_CFG["y"]), int(TITULO_CFG["h"])),
            line_spacing=titulo_fit["line_spacing"],
        ))

    if FRASE_CFG.get("visible", True) and frase_fit["text"]:
        draw_ops.append(drawtext_block(
            text=frase_fit["text"],
            font_path=FONT_BOLD,
            font_size=frase_fit["font_size"],
            color_hex=str(FRASE_CFG.get("color", rgb_to_hex(cor_texto_sec))),
            x_expr=box_x_expr(
                int(FRASE_CFG["x"]),
                int(FRASE_CFG["w"]),
                FRASE_CFG.get("align", "center"),
                int(FRASE_CFG.get("pad_x", 0))
            ),
            y_expr=box_y_expr(int(FRASE_CFG["y"]), int(FRASE_CFG["h"])),
            line_spacing=frase_fit["line_spacing"],
        ))

    if ARTILHEIROS_CFG.get("visible", True) and artilheiros_fit["text"]:
        draw_ops.append(drawtext_block(
            text=artilheiros_fit["text"],
            font_path=FONT_REG,
            font_size=artilheiros_fit["font_size"],
            color_hex=str(ARTILHEIROS_CFG.get("color", rgb_to_hex(cor_texto_sec))),
            x_expr=box_x_expr(
                int(ARTILHEIROS_CFG["x"]),
                int(ARTILHEIROS_CFG["w"]),
                ARTILHEIROS_CFG.get("align", "center"),
                int(ARTILHEIROS_CFG.get("pad_x", 0))
            ),
            y_expr=box_y_expr(int(ARTILHEIROS_CFG["y"]), int(ARTILHEIROS_CFG["h"])),
            line_spacing=artilheiros_fit["line_spacing"],
        ))

    draw_chain = ",".join(draw_ops)

    filter_parts = [
        f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,"
        f"crop={W}:{H},"
        f"eq=brightness={BG_BRIGHTNESS}:saturation={BG_SATURATION}:contrast={BG_CONTRAST},"
        f"setsar=1[base0]"
    ]

    input_index = 1
    current_base = "base0"
    overlay_count = 0

    if LOGO_VISIBLE:
        filter_parts.append(f"[{input_index}:v]scale={LOGO_W}:{LOGO_H}[esc]")
        input_index += 1
    else:
        filter_parts.append(f"color=c=black@0.0:s=2x2[esc]")

    if moldura_src and layout["moldura"].get("visible", True):
        filter_parts.append(f"[{input_index}:v]scale={W}:{H}[mold]")
        next_base = f"base{overlay_count + 1}"
        filter_parts.append(f"[{current_base}][mold]overlay={MOLDURA_X}:{MOLDURA_Y}[{next_base}]")
        current_base = next_base
        overlay_count += 1
        input_index += 1

    if topo_src and layout["topo"].get("visible", True):
        filter_parts.append(f"[{input_index}:v]scale={TOPO_BOX_W}:{TOPO_BOX_H},format=rgba,colorchannelmixer=aa=0.8[topo]")
        next_base = f"base{overlay_count + 1}"
        filter_parts.append(f"[{current_base}][topo]overlay={TOPO_BOX_X}:{TOPO_BOX_Y}[{next_base}]")
        current_base = next_base
        overlay_count += 1
        input_index += 1

    if faixa1_src and layout["faixa_principal"].get("visible", True):
        filter_parts.append(f"[{input_index}:v]scale={FAIXA1_W}:{FAIXA1_H},format=rgba,colorchannelmixer=aa=0.7[faixa1]")
        next_base = f"base{overlay_count + 1}"
        filter_parts.append(f"[{current_base}][faixa1]overlay={FAIXA1_X}:{FAIXA1_Y}[{next_base}]")
        current_base = next_base
        overlay_count += 1
        input_index += 1

    if faixa2_src and layout["faixa_secundaria"].get("visible", True):
        filter_parts.append(f"[{input_index}:v]scale={FAIXA2_W}:{FAIXA2_H},format=rgba,colorchannelmixer=aa=0.5[faixa2]")
        next_base = f"base{overlay_count + 1}"
        filter_parts.append(f"[{current_base}][faixa2]overlay={FAIXA2_X}:{FAIXA2_Y}[{next_base}]")
        current_base = next_base
        overlay_count += 1
        input_index += 1

    if LOGO_VISIBLE:
        next_base = f"base{overlay_count + 1}"
        filter_parts.append(f"[{current_base}][esc]overlay={LOGO_X}:{LOGO_Y}[{next_base}]")
        current_base = next_base
        overlay_count += 1

    if draw_chain:
        filter_parts.append(f"[{current_base}]{draw_chain}[out]")
    else:
        filter_parts.append(f"[{current_base}]copy[out]")

    filter_complex = ";".join(filter_parts)

    cmd = [
        FFMPEG_BIN,
        "-y",
        "-i", str(foto_jogo),
    ]

    if LOGO_VISIBLE:
        cmd += ["-i", str(escudo)]

    if moldura_src and layout["moldura"].get("visible", True):
        cmd += ["-i", str(moldura_t)]
    if topo_src and layout["topo"].get("visible", True):
        cmd += ["-i", str(topo_t)]
    if faixa1_src and layout["faixa_principal"].get("visible", True):
        cmd += ["-i", str(faixa1_t)]
    if faixa2_src and layout["faixa_secundaria"].get("visible", True):
        cmd += ["-i", str(faixa2_t)]

    cmd += [
        "-filter_complex", filter_complex,
        "-map", "[out]",
        "-frames:v", "1",
        str(out_final_pedido)
    ]

    run_ffmpeg(cmd)
    shutil.copy2(out_final_pedido, out_final_geral)
    upload_resultado_para_site(pedido_dir, pedido_id, out_final_pedido)

    info = {
        "pedido_id": pedido_id,
        "template_dir": str(TEMPLATE_DIR),
        "palette_source": palette_source,
        "cor_primaria": rgb_to_hex(cor_primaria),
        "cor_secundaria": rgb_to_hex(cor_secundaria),
        "cor_texto_principal": rgb_to_hex(cor_texto),
        "cor_texto_secundaria": rgb_to_hex(cor_texto_sec),
        "resultado_final": str(out_final_pedido),
        "resultado_copia": str(out_final_geral),
        "artilheiros_raw": artilheiros_raw,
        "artilheiros_processados": artilheiros,
        "artilheiros_texto": artilheiros_fit["text"],
        "layout_json": layout,
        "layout_renderizado": {
            "moldura": {"x": MOLDURA_X, "y": MOLDURA_Y, "w": W, "h": H, "visible": layout["moldura"].get("visible", True)},
            "logo": {"x": LOGO_X, "y": LOGO_Y, "w": LOGO_W, "h": LOGO_H, "visible": LOGO_VISIBLE},
            "topo_box": {"x": TOPO_BOX_X, "y": TOPO_BOX_Y, "w": TOPO_BOX_W, "h": TOPO_BOX_H, "visible": layout["topo"].get("visible", True)},
            "faixa_principal": {"x": FAIXA1_X, "y": FAIXA1_Y, "w": FAIXA1_W, "h": FAIXA1_H, "visible": layout["faixa_principal"].get("visible", True)},
            "faixa_secundaria": {"x": FAIXA2_X, "y": FAIXA2_Y, "w": FAIXA2_W, "h": FAIXA2_H, "visible": layout["faixa_secundaria"].get("visible", True)},
            "time_principal": {"text": tp_fit["text"], "font": tp_fit["font_size"], "cfg": TIME_PRINCIPAL_CFG},
            "gols_time_principal": {"text": gt_fit["text"], "font": gt_fit["font_size"], "cfg": GOLS_TIME_CFG},
            "placar_x": {"text": px_fit["text"], "font": px_fit["font_size"], "cfg": PLACAR_X_CFG},
            "gols_adversario": {"text": ga_fit["text"], "font": ga_fit["font_size"], "cfg": GOLS_ADV_CFG},
            "time_adversario": {"text": ta_fit["text"], "font": ta_fit["font_size"], "cfg": TIME_ADV_CFG},
            "titulo": {"text": titulo_fit["text"], "font": titulo_fit["font_size"], "cfg": TITULO_CFG},
            "frase": {"text": frase_fit["text"], "font": frase_fit["font_size"], "cfg": FRASE_CFG},
            "artilheiros": {"text": artilheiros_fit["text"], "font": artilheiros_fit["font_size"], "cfg": ARTILHEIROS_CFG},
            "fallback_placar_legacy": {"text": placar_fit["text"], "font": placar_fit["font_size"]},
            "fallback_nome_time_legacy": {"text": nome_time_fit["text"], "font": nome_time_fit["font_size"]},
        }
    }

    if "raw" in palette:
        info["openai_raw"] = palette["raw"]

    (pedido_dir / "resultado_cores.json").write_text(
        json.dumps(info, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    log(f"✅ Final salvo em: {out_final_pedido}")
    log(f"✅ Cópia salva em: {out_final_geral}")

if __name__ == "__main__":
    main()