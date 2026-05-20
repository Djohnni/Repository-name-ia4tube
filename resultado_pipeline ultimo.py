import json
import base64
import shutil
import subprocess
import mimetypes
import re
from pathlib import Path
from collections import Counter

import cv2
import numpy as np
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
PROMPT_PALETA_FILE = BASE_DIR / "prompt_paleta.json"

OPENAI_URL = "https://api.openai.com/v1/responses"
OPENAI_MODEL = "gpt-4.1-mini"
OPENAI_IMAGE_URL = "https://api.openai.com/v1/images/generations"
OPENAI_IMAGE_MODEL = "gpt-image-1-mini"

FFMPEG_BIN = "ffmpeg"

W = 1080
H = 1920

FONT_MAP = {
    "pesada impactante": r"C:/Windows/Fonts/arialbd.ttf",
    "condensada esportiva": r"C:/Windows/Fonts/arialbd.ttf",
    "moderna agressiva": r"C:/Windows/Fonts/arialbd.ttf",
    "tecnologica futurista": r"C:/Windows/Fonts/arial.ttf",
    "elegante forte": r"C:/Windows/Fonts/arial.ttf"
}

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

def load_prompt_paleta(team_name: str = "") -> str:
    if not PROMPT_PALETA_FILE.exists():
        raise FileNotFoundError(
            f"Não achei {PROMPT_PALETA_FILE.name} na mesma pasta do script."
        )

    data = load_json(PROMPT_PALETA_FILE)

    if not isinstance(data, dict):
        raise ValueError(f"{PROMPT_PALETA_FILE.name} precisa ser um JSON objeto.")

    prompt_template = str(data.get("prompt", "")).strip()
    if not prompt_template:
        raise ValueError(f"{PROMPT_PALETA_FILE.name} está sem o campo 'prompt'.")

    team_name_value = team_name or "não informado"
    prompt = prompt_template.replace("{team_name}", team_name_value)
    return prompt.strip()

def rgb_to_hex(rgb):
    return "#{:02x}{:02x}{:02x}".format(*rgb)

def hex_to_rgb(hx: str):
    hx = hx.strip().lstrip("#")
    if len(hx) != 6:
        raise ValueError(f"HEX inválido: {hx}")
    return tuple(int(hx[i:i+2], 16) for i in (0, 2, 4))

def clamp_opacity(value, default=1.0) -> float:
    try:
        value = float(value)
    except Exception:
        value = default
    return max(0.0, min(1.0, value))

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

    print("FFMPEG STDOUT:")
    print(result.stdout)
    print("FFMPEG STDERR:")
    print(result.stderr)

    if result.returncode != 0:
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
    font_path_ffmpeg = str(font_path).replace("\\", "/").replace(":", r"\:")

    return (
        f"drawtext=fontfile='{font_path_ffmpeg}':text='{ffmpeg_escape(text)}':"
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
# MOTOR TXT
# =========================================================
CORES_UNIVERSAIS = {
    'vermelho': {'baixo': [0, 15, 15], 'alto': [10, 255, 255]},
    'vinho': {'baixo': [0, 50, 50], 'alto': [10, 200, 200]},
    'bordo': {'baixo': [0, 50, 50], 'alto': [10, 200, 200]},
    'amarelo': {'baixo': [15, 15, 15], 'alto': [40, 255, 255]},
    'dourado': {'baixo': [20, 100, 100], 'alto': [35, 255, 255]},
    'mostarda': {'baixo': [20, 80, 80], 'alto': [35, 255, 200]},
    'verde': {'baixo': [40, 15, 15], 'alto': [85, 255, 255]},
    'verde_limao': {'baixo': [50, 100, 100], 'alto': [80, 255, 255]},
    'verde_escuro': {'baixo': [40, 50, 50], 'alto': [85, 200, 200]},
    'ciano': {'baixo': [85, 15, 15], 'alto': [105, 255, 255]},
    'azul': {'baixo': [100, 10, 10], 'alto': [135, 255, 255]},
    'azul_marinho': {'baixo': [100, 50, 20], 'alto': [130, 255, 150]},
    'azul_claro': {'baixo': [85, 50, 100], 'alto': [115, 255, 255]},
    'roxo': {'baixo': [135, 15, 15], 'alto': [160, 255, 255]},
    'magenta': {'baixo': [140, 80, 80], 'alto': [170, 255, 255]},
    'lilas': {'baixo': [135, 50, 150], 'alto': [160, 200, 255]},
    'laranja': {'baixo': [10, 100, 100], 'alto': [25, 255, 255]},
    'marrom': {'baixo': [10, 50, 20], 'alto': [20, 200, 150]},
    'bege': {'baixo': [15, 30, 150], 'alto': [40, 120, 255]},
    'cinza': {'s': 0, 'v': 180, 'is_color': False},
    'prata': {'s': 0, 'v': 200, 'is_color': False},
    'branco': {'s': 0, 'v': 255, 'is_color': False},
    'preto': {'s': 0, 'v': 0, 'is_color': False}
}

def parse_color_string_to_config(color_str: str):
    color_str = str(color_str or "").strip().lower()
    if not color_str:
        return None

    if color_str in CORES_UNIVERSAIS:
        return CORES_UNIVERSAIS[color_str].copy()

    if color_str.startswith("#"):
        return hex_para_config(color_str)

    m = re.match(r"rgba?\(([^)]+)\)", color_str)
    if m:
        partes = [p.strip() for p in m.group(1).split(",")]
        if len(partes) < 3:
            return None
        try:
            r = max(0, min(255, int(float(partes[0]))))
            g = max(0, min(255, int(float(partes[1]))))
            b = max(0, min(255, int(float(partes[2]))))
        except Exception:
            return None
        return hex_para_config(f"#{r:02X}{g:02X}{b:02X}")

    return None

def criar_mascara(hsv, cor_nome):
    config_origem = cor_nome if isinstance(cor_nome, dict) else parse_color_string_to_config(cor_nome)
    if not config_origem:
        return None

    if config_origem.get('is_color', True):
        h = int(config_origem.get('h', 0))
        tol_h = int(config_origem.get('tol_h', 10))
        s_min = int(config_origem.get('s_min', 15))
        v_min = int(config_origem.get('v_min', 15))

        h1 = h - tol_h
        h2 = h + tol_h

        if h1 < 0:
            mascara1 = cv2.inRange(hsv, np.array([0, s_min, v_min]), np.array([h2, 255, 255]))
            mascara2 = cv2.inRange(hsv, np.array([180 + h1, s_min, v_min]), np.array([179, 255, 255]))
            return cv2.bitwise_or(mascara1, mascara2)

        if h2 > 179:
            mascara1 = cv2.inRange(hsv, np.array([h1, s_min, v_min]), np.array([179, 255, 255]))
            mascara2 = cv2.inRange(hsv, np.array([0, s_min, v_min]), np.array([h2 - 180, 255, 255]))
            return cv2.bitwise_or(mascara1, mascara2)

        return cv2.inRange(hsv, np.array([h1, s_min, v_min]), np.array([h2, 255, 255]))

    s_max = int(config_origem.get('s_max', 40))
    v = int(config_origem.get('v', 0))
    tol_v = int(config_origem.get('tol_v', 45))
    baixo = np.array([0, 0, max(0, v - tol_v)])
    alto = np.array([179, s_max, min(255, v + tol_v)])
    return cv2.inRange(hsv, baixo, alto)

def detectar_cores_na_imagem(img_path: Path, cobertura_minima: float = 0.01) -> list[str]:
    img = cv2.imread(str(img_path), cv2.IMREAD_UNCHANGED)
    if img is None:
        raise FileNotFoundError(f"Erro ao abrir imagem para detectar cores: {img_path}")

    if len(img.shape) == 2:
        bgr = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
        alpha = None
    elif img.shape[2] == 4:
        bgr = img[:, :, :3].copy()
        alpha = img[:, :, 3].copy()
    else:
        bgr = img.copy()
        alpha = None

    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    total_pixels_validos = bgr.shape[0] * bgr.shape[1]

    if alpha is not None:
        total_pixels_validos = int(np.sum(alpha > 0))
        if total_pixels_validos <= 0:
            total_pixels_validos = bgr.shape[0] * bgr.shape[1]

    cores_detectadas = []

    for cor_nome in CORES_UNIVERSAIS.keys():
        if cor_nome in ("preto", "branco"):
            continue

        mascara = criar_mascara(hsv, cor_nome)
        if mascara is None:
            continue

        if alpha is not None:
            mascara = np.where(alpha > 0, mascara, 0).astype(np.uint8)

        qtd = int(np.sum(mascara > 0))
        proporcao = qtd / max(1, total_pixels_validos)

        if proporcao >= cobertura_minima:
            cores_detectadas.append(cor_nome)

    return sorted(set(cores_detectadas))

def gerar_txt_automatico_por_cor_detectada(src_path: Path, txt_path: Path, cor_destino_hex: str):
    if txt_path.exists():
        log(f"ℹ️ {txt_path.name} já existe; mantendo regras existentes.")
        return

    cores_detectadas = detectar_cores_na_imagem(src_path)

    if not cores_detectadas:
        log(f"⚠️ Nenhuma cor detectada em {src_path.name}; TXT automático não foi criado.")
        return

    linhas = [f"{cor} = {cor_destino_hex.upper()}" for cor in cores_detectadas]
    txt_path.write_text("\n".join(linhas), encoding="utf-8")
    log(f"🔥 {txt_path.name} criado automaticamente com: {', '.join(linhas)}")

def detectar_cores_exatas_na_imagem(img_path: Path, max_cores: int = 6, min_pixels: int = 40) -> list[str]:
    img = cv2.imread(str(img_path), cv2.IMREAD_UNCHANGED)
    if img is None:
        raise FileNotFoundError(f"Erro ao abrir imagem para detectar cores exatas: {img_path}")

    if len(img.shape) == 2:
        bgr = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
        alpha = None
    elif img.shape[2] == 4:
        bgr = img[:, :, :3].copy()
        alpha = img[:, :, 3].copy()
    else:
        bgr = img.copy()
        alpha = None

    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    pixels = rgb.reshape(-1, 3)

    if alpha is not None:
        mask_alpha = (alpha.reshape(-1) > 0)
        pixels = pixels[mask_alpha]

    if len(pixels) == 0:
        return []

    quant = (np.round(pixels / 16) * 16).clip(0, 255).astype(np.uint8)
    counter = Counter(map(tuple, quant.tolist()))

    cores = []
    for cor, qtd in counter.most_common():
        if qtd < min_pixels:
            continue
        hx = "#{:02X}{:02X}{:02X}".format(*cor)
        if hx not in cores:
            cores.append(hx)
        if len(cores) >= max_cores:
            break

    return cores

def normalizar_destinos_txt(regras: dict, fallback_hexes: list[str]) -> list[str]:
    destinos = []
    for destino in regras.values():
        destino = str(destino or "").strip().upper()
        if not destino:
            continue
        if destino.startswith("#") and len(destino) == 7:
            destinos.append(destino)

    for hx in fallback_hexes:
        hx = str(hx or "").strip().upper()
        if hx.startswith("#") and len(hx) == 7:
            destinos.append(hx)

    unicos = []
    for d in destinos:
        if d not in unicos:
            unicos.append(d)
    return unicos

def complementar_txt_com_cores_detectadas(src_path: Path, txt_path: Path, fallback_hexes: list[str]):
    regras = ler_regras_txt(txt_path)
    destinos = normalizar_destinos_txt(regras, fallback_hexes)

    if not destinos:
        return

    cores_exatas = detectar_cores_exatas_na_imagem(src_path)
    if not cores_exatas:
        return

    regras_finais = {}
    idx = 0
    for cor in cores_exatas:
        regras_finais[cor.lower()] = destinos[min(idx, len(destinos) - 1)]
        if idx < len(destinos) - 1:
            idx += 1

    for origem, destino in regras.items():
        origem_norm = str(origem or "").strip().lower()
        destino_norm = str(destino or "").strip().upper()
        if origem_norm and destino_norm and origem_norm not in regras_finais:
            regras_finais[origem_norm] = destino_norm

    linhas = [f"{origem} = {destino}" for origem, destino in regras_finais.items()]
    txt_path.write_text("\n".join(linhas), encoding="utf-8")
    log(f"🧠 TXT ajustado com cores reais detectadas em {src_path.name}: {txt_path.name}")

def hex_para_config(hex_str):
    hex_str = hex_str.lstrip('#')
    try:
        r, g, b = tuple(int(hex_str[i:i+2], 16) for i in (0, 2, 4))
        pixel_bgr = np.uint8([[[b, g, r]]])
        pixel_hsv = cv2.cvtColor(pixel_bgr, cv2.COLOR_BGR2HSV)[0][0]
        h, s, v = pixel_hsv

        if v < 50:
            return {'s': 0, 'v': 0, 'is_color': False}
        elif s < 30 and v > 200:
            return {'s': 0, 'v': 255, 'is_color': False}
        else:
            return {'h': int(h), 'is_color': True}
    except ValueError:
        return None

def ler_regras_txt(caminho_txt: Path):
    regras = {}
    if not caminho_txt.exists():
        return regras

    with open(caminho_txt, 'r', encoding='utf-8') as f:
        linhas = f.readlines()
        for linha in linhas:
            if '=' in linha:
                origem, destino = linha.split('=', 1)
                regras[origem.strip().lower()] = destino.strip().upper()
    return regras

def aplicar_regras_txt(src_path: Path, dst_path: Path, txt_path: Path):
    if not src_path.exists():
        return

    if not txt_path.exists():
        shutil.copy2(src_path, dst_path)
        log(f"⚠️ Sem regras em {txt_path.name}; copiado original.")
        return

    regras = ler_regras_txt(txt_path)
    if not regras:
        shutil.copy2(src_path, dst_path)
        log(f"⚠️ {txt_path.name} vazio ou inválido; copiado original.")
        return

    img = cv2.imread(str(src_path), cv2.IMREAD_UNCHANGED)
    if img is None:
        raise FileNotFoundError(f"Erro ao abrir asset: {src_path}")

    alpha = None
    if len(img.shape) == 2:
        bgr = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    elif img.shape[2] == 4:
        bgr = img[:, :, :3].copy()
        alpha = img[:, :, 3].copy()
    else:
        bgr = img.copy()

    template_processado = bgr.copy()
    hsv_original = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)

    for cor_origem, cor_destino in regras.items():
        config_origem = parse_color_string_to_config(cor_origem)
        if config_origem is None:
            log(f"⚠️ Cor base desconhecida em {txt_path.name}: {cor_origem}")
            continue

        config_destino = None
        if cor_destino.startswith('#'):
            config_destino = hex_para_config(cor_destino)
        elif cor_destino.lower() in CORES_UNIVERSAIS:
            config_destino = CORES_UNIVERSAIS[cor_destino.lower()].copy()
            if 'h' not in config_destino and 's' not in config_destino:
                meio = int((config_destino['baixo'][0] + config_destino['alto'][0]) / 2)
                config_destino = {'h': meio, 'is_color': True}

        if config_destino is None:
            log(f"⚠️ Destino inválido em {txt_path.name}: {cor_destino}")
            continue

        mascara = criar_mascara(hsv_original, config_origem)
        if mascara is None:
            continue

        if alpha is not None:
            mascara = np.where(alpha > 0, mascara, 0).astype(np.uint8)

        mascara = cv2.GaussianBlur(mascara, (25, 25), 0)

        hsv_novo = hsv_original.copy()

        if config_destino['is_color']:
            hsv_novo[:, :, 0] = np.where(mascara > 0, config_destino['h'], hsv_novo[:, :, 0])
        else:
            hsv_novo[:, :, 1] = np.where(mascara > 0, config_destino['s'], hsv_novo[:, :, 1])
            if config_destino['v'] == 255:
                brilho_atual = hsv_novo[:, :, 2].astype(int)
                novo_brilho = np.clip(brilho_atual + 100, 0, 255)
                hsv_novo[:, :, 2] = np.where(mascara > 0, novo_brilho, hsv_novo[:, :, 2]).astype(np.uint8)
            else:
                hsv_novo[:, :, 2] = np.where(mascara > 0, 0, hsv_novo[:, :, 2])

        img_nova_cor = cv2.cvtColor(hsv_novo, cv2.COLOR_HSV2BGR)

        mascara_float = mascara.astype(np.float32) / 255.0
        mascara_float = cv2.merge([mascara_float, mascara_float, mascara_float])

        template_processado = template_processado * (1 - mascara_float) + img_nova_cor * mascara_float
        template_processado = template_processado.astype(np.uint8)

    if alpha is not None:
        out = np.dstack([template_processado, alpha])
    else:
        out = template_processado

    cv2.imwrite(str(dst_path), out)
    log(f"✅ Regras aplicadas: {txt_path.name} -> {dst_path.name}")

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
# CORES / FONTE / FOTO (mantidos)
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
            "primary_opacity": 0.85,
            "secondary_opacity": 0.75,
            "font_style": "condensada esportiva",
            "photo_mode": "contain_center",
            "photo_box_x": 170,
            "photo_box_y": 470,
            "photo_box_w": 740,
            "photo_box_h": 520,
            "raw": {}
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
        "primary_opacity": 0.85,
        "secondary_opacity": 0.75,
        "font_style": "condensada esportiva",
        "photo_mode": "contain_center",
        "photo_box_x": 170,
        "photo_box_y": 470,
        "photo_box_w": 740,
        "photo_box_h": 520,
        "raw": {}
    }

def generate_background_image(prompt: str, output_path: Path):
    prompt = (prompt or "").strip()
    if not prompt:
        raise ValueError("background_prompt veio vazio.")

    api_key = load_api_key()

    payload = {
        "model": OPENAI_IMAGE_MODEL,
        "prompt": prompt,
        "size": "auto",
        "background": "opaque",
        "output_format": "png"
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    log("Consultando OpenAI para gerar o fundo...")
    resp = requests.post(OPENAI_IMAGE_URL, headers=headers, json=payload, timeout=300)

    if resp.status_code != 200:
        raise RuntimeError(f"OpenAI Image HTTP {resp.status_code}: {resp.text[:1000]}")

    data = resp.json()
    images = data.get("data", [])
    if not images:
        raise RuntimeError("A API de imagem não retornou nenhuma imagem.")

    b64 = images[0].get("b64_json", "")
    if not b64:
        raise RuntimeError("A API de imagem não retornou b64_json.")

    output_path.write_bytes(base64.b64decode(b64))
    log(f"🖼️ Fundo gerado salvo em: {output_path}")

def get_palette_from_openai(escudo1_path: Path, escudo2_path: Path | None, team_name: str = "") -> dict:
    api_key = load_api_key()
    image_data_url_escudo1 = image_to_data_url(escudo1_path)
    image_data_url_escudo2 = image_to_data_url(escudo2_path) if escudo2_path and escudo2_path.exists() else None
    image_data_url_template = image_to_data_url(TEMPLATE_DIR / "faixa_secundaria.png")
    
    moldura_path = TEMPLATE_DIR / "moldura.png"
    image_data_url_moldura = None
    if moldura_path.exists():
        image_data_url_moldura = image_to_data_url(moldura_path)

    prompt = load_prompt_paleta(team_name=team_name)

    prompt_injetado = (
        prompt
        + "\n\nORDEM EXATA DAS IMAGENS ENVIADAS:"
        + "\n1) TEMPLATE DA PEÇA faixa_secundaria.png -> você deve identificar as cores visíveis dessa peça."
    )
    
    if image_data_url_moldura:
        prompt_injetado += "\n2) TEMPLATE DA MOLDURA moldura.png -> você deve identificar as cores visíveis dessa peça."
        prompt_injetado += "\n3) ESCUDO 1 (time principal) -> essa imagem manda totalmente no lado esquerdo do fundo e na identidade visual do time principal."
        prompt_injetado += "\n4) ESCUDO 2 (adversário) -> essa imagem manda totalmente no lado direito do fundo e na identidade visual do adversário."
    else:
        prompt_injetado += "\n2) ESCUDO 1 (time principal) -> essa imagem manda totalmente no lado esquerdo do fundo e na identidade visual do time principal."
        prompt_injetado += "\n3) ESCUDO 2 (adversário) -> essa imagem manda totalmente no lado direito do fundo e na identidade visual do adversário."

    prompt_injetado += (
        "\n\nMISSÃO ESPECÍFICA:"
        + "\n- Analise a faixa_secundaria.png e (se enviada) a moldura.png."
        + "\n- Identifique as cores reais existentes nelas."
        + "\n- Cruze isso SOMENTE com os escudos enviados."
        + "\n- Ignore totalmente qualquer influência de foto do jogo."
        + "\n- Gere os campos txt_moldura, txt_topo, txt_faixa_principal e txt_faixa_secundaria com as trocas corretas."
        + "\n- O txt_moldura será aplicado na moldura."
        + "\n- O txt_topo será aplicado no topo_barra."
        + "\n- O txt_faixa_principal será aplicado na faixa_principal."
        + "\n- O txt_faixa_secundaria será aplicado na faixa_secundaria."
        + "\n- Não invente cores-base que não existam na peça."
        + "\n- Gere SOMENTE os campos txt_moldura, txt_topo, txt_faixa_principal e txt_faixa_secundaria quando existirem."
        + "\n- NÃO gere background_prompt."
        + "\n- NÃO gere background_negative_prompt."
        + "\n- Se o prompt carregado não pedir fundo, respeite isso totalmente."
    )

    content_list = [
        {"type": "input_text", "text": prompt_injetado},
        {"type": "input_image", "image_url": image_data_url_template, "detail": "high"},
    ]
    
    if image_data_url_moldura:
        content_list.append({"type": "input_image", "image_url": image_data_url_moldura, "detail": "high"})
        
    content_list.append({"type": "input_image", "image_url": image_data_url_escudo1, "detail": "high"})

    if image_data_url_escudo2:
        content_list.append({"type": "input_image", "image_url": image_data_url_escudo2, "detail": "high"})

    payload = {
        "model": OPENAI_MODEL,
        "input": [
            {
                "role": "user",
                "content": content_list
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

    text_on_primary_hex = str(parsed.get("text_on_primary_hex", "#FFFFFF")).strip()
    text_on_secondary_hex = str(parsed.get("text_on_secondary_hex", "#FFFFFF")).strip()

    text_on_primary = hex_to_rgb(text_on_primary_hex)
    text_on_secondary = hex_to_rgb(text_on_secondary_hex)

    primary_opacity = clamp_opacity(parsed.get("primary_opacity", 0.85), 0.85)
    secondary_opacity = clamp_opacity(parsed.get("secondary_opacity", 0.75), 0.75)
    font_style = str(parsed.get("font_style", "condensada esportiva")).strip().lower()

    photo_mode = str(parsed.get("photo_mode", "contain_center")).strip().lower()
    if photo_mode not in {"contain_center"}:
        photo_mode = "contain_center"

    def safe_int(value, default):
        try:
            return int(value)
        except Exception:
            return default

    photo_box_x = safe_int(parsed.get("photo_box_x", 170), 170)
    photo_box_y = safe_int(parsed.get("photo_box_y", 470), 470)
    photo_box_w = safe_int(parsed.get("photo_box_w", 740), 740)
    photo_box_h = safe_int(parsed.get("photo_box_h", 520), 520)

    photo_box_x = max(0, min(W - 40, photo_box_x))
    photo_box_y = max(0, min(H - 40, photo_box_y))
    photo_box_w = max(120, min(W - photo_box_x, photo_box_w))
    photo_box_h = max(120, min(H - photo_box_y, photo_box_h))

    return {
        "primary": primary,
        "secondary": secondary,
        "text_on_primary": text_on_primary,
        "text_on_secondary": text_on_secondary,
        "primary_opacity": primary_opacity,
        "secondary_opacity": secondary_opacity,
        "font_style": font_style,
        "photo_mode": photo_mode,
        "photo_box_x": photo_box_x,
        "photo_box_y": photo_box_y,
        "photo_box_w": photo_box_w,
        "photo_box_h": photo_box_h,
        "txt_moldura": parsed.get("txt_moldura", ""),
        "txt_topo": parsed.get("txt_topo", ""),
        "txt_faixa_principal": parsed.get("txt_faixa_principal", ""),
        "txt_faixa_secundaria": parsed.get("txt_faixa_secundaria", ""),
        "background_prompt": parsed.get("background_prompt", ""),
        "background_negative_prompt": parsed.get("background_negative_prompt", ""),
        "raw": parsed,
    }

# =========================================================
# UPLOAD
# =========================================================
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

    foto_jogo = None
    escudo = None
    escudo2 = None

    # NOVO PADRÃO (pedido.json)
    foto_nome = str(pedido.get("foto_jogo", "")).strip()
    escudo_nome = str(pedido.get("escudo_principal", "")).strip()
    escudo2_nome = str(pedido.get("escudo2", "")).strip()

    if foto_nome:
        foto_jogo = find_existing(pedido_dir, [foto_nome])
    if escudo_nome:
        escudo = find_existing(pedido_dir, [escudo_nome])
    if escudo2_nome:
        escudo2 = find_existing(pedido_dir, [escudo2_nome])

    # FALLBACK (padrão antigo)
    if not foto_jogo:
        foto_jogo = find_existing(
            pedido_dir,
            ["foto_jogo.png", "foto_jogo.jpg", "foto_jogo.jpeg", "foto_jogo.webp", "foto.png", "foto.jpg", "foto.jpeg", "foto.webp"]
        )

    if not escudo:
        escudo = find_existing(
            pedido_dir,
            ["escudo_principal_sem_fundo.png", "escudo_principal.png", "escudo_principal.jpg", "escudo_principal.jpeg", "escudo_principal.webp", "escudo1_sem_fundo.png", "escudo1.png", "escudo1.jpg", "escudo1.jpeg", "escudo1.webp"]
        )

    if not escudo2:
        escudo2 = find_existing(
            pedido_dir,
            ["escudo2_sem_fundo.png", "escudo2.png", "escudo2.jpg", "escudo2.jpeg", "escudo2.webp", "escudo_adversario_sem_fundo.png", "escudo_adversario.png", "escudo_adversario.jpg", "escudo_adversario.jpeg", "escudo_adversario.webp"]
        )

    if not foto_jogo:
        raise SystemExit("Imagem do jogo não encontrada")
    if not escudo:
        raise SystemExit("Escudo do time principal não encontrado")

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
        artilheiros_texto = "Artilheiros:\n" + "\n".join(artilheiros_linhas)

    try:
        palette = get_palette_from_openai(escudo, escudo2 if escudo2 else None, team_name=nome_time)
        cor_primaria = palette["primary"]
        cor_secundaria = palette["secondary"]
        cor_texto = palette["text_on_primary"]
        cor_texto_sec = palette["text_on_secondary"]
        opacidade_primaria = 1.0
        opacidade_secundaria = 1.0
        font_style = palette.get("font_style", "condensada esportiva")
        photo_mode = palette.get("photo_mode", "contain_center")
        photo_box_x = int(palette.get("photo_box_x", 170))
        photo_box_y = int(palette.get("photo_box_y", 470))
        photo_box_w = int(palette.get("photo_box_w", 740))
        photo_box_h = int(palette.get("photo_box_h", 520))
        palette_source = "openai"
    except Exception as e:
        log(f"⚠️ OpenAI falhou, usando fallback local: {e}")
        palette = extract_main_colors_local(escudo)
        cor_primaria = palette["primary"]
        cor_secundaria = palette["secondary"]
        cor_texto = palette["text_on_primary"]
        cor_texto_sec = palette["text_on_secondary"]
        opacidade_primaria = palette["primary_opacity"]
        opacidade_secundaria = palette["secondary_opacity"]
        font_style = "condensada esportiva"
        photo_mode = "contain_center"
        photo_box_x = 170
        photo_box_y = 470
        photo_box_w = 740
        photo_box_h = 520
        palette_source = "local"

    if "photo_box" in layout:
        try:
            photo_box_data = layout["photo_box"]
            photo_box_x = int(photo_box_data.get("x", photo_box_x))
            photo_box_y = int(photo_box_data.get("y", photo_box_y))
            photo_box_w = int(photo_box_data.get("w", photo_box_w))
            photo_box_h = int(photo_box_data.get("h", photo_box_h))
            log("📦 Usando coordenadas da foto vindas de layout.json")
        except Exception as e:
            log(f"⚠️ Erro ao ler photo_box do layout.json: {e}")

    log(f"Paleta origem: {palette_source}")
    log(f"Cor primária: {cor_primaria} {rgb_to_hex(cor_primaria)}")
    log(f"Cor secundária: {cor_secundaria} {rgb_to_hex(cor_secundaria)}")
    log(f"Texto sobre primária: {cor_texto} {rgb_to_hex(cor_texto)}")
    log(f"Texto sobre secundária: {cor_texto_sec} {rgb_to_hex(cor_texto_sec)}")
    log(f"Opacidade primária: {opacidade_primaria}")
    log(f"Opacidade secundária: {opacidade_secundaria}")
    log(f"Font style: {font_style}")
    log(f"Photo mode: {photo_mode}")
    log(f"Photo box: x={photo_box_x}, y={photo_box_y}, w={photo_box_w}, h={photo_box_h}")

    FONT_BOLD = FONT_MAP.get(font_style, r"C:/Windows/Fonts/arialbd.ttf")
    FONT_REG = FONT_MAP.get(font_style, r"C:/Windows/Fonts/arial.ttf")

    temp_dir = pedido_dir / "_resultado_temp"
    if temp_dir.exists():
        shutil.rmtree(temp_dir)
    temp_dir.mkdir(parents=True, exist_ok=True)

    bg_prompt = str(palette.get("background_prompt", "")).strip()
    bg_negative_prompt = str(palette.get("background_negative_prompt", "")).strip()
    bg_path = temp_dir / "background_gerado.png"

    if not bg_prompt:
        log("🚫 Sem background_prompt — NÃO será gerado fundo.")
        bg_path = foto_jogo

    if bg_negative_prompt:
        bg_prompt += f"\n\nEVITAR TOTALMENTE: {bg_negative_prompt}"

    if bg_prompt:
        generate_background_image(bg_prompt, bg_path)
    else:
        log("🚫 Pulando geração de fundo — usando imagem existente.")

    moldura_src = optional_template_file(TEMPLATE_DIR, ["moldura.png"])
    topo_src = optional_template_file(TEMPLATE_DIR, ["topo_barra.png", "topo.png"])
    faixa1_src = optional_template_file(TEMPLATE_DIR, ["faixa_principal.png"])
    faixa2_src = optional_template_file(TEMPLATE_DIR, ["faixa_secundaria.png"])

    moldura_t = temp_dir / "moldura_t.png"
    topo_t = temp_dir / "topo_t.png"
    faixa1_t = temp_dir / "faixa1_t.png"
    faixa2_t = temp_dir / "faixa2_t.png"

    moldura_txt = pedido_dir / "moldura.txt"
    topo_txt = pedido_dir / "topo.txt"
    faixa1_txt = pedido_dir / "faixa_principal.txt"
    faixa2_txt = pedido_dir / "faixa_secundaria.txt"

    def salvar_txt_api(path, conteudo):
        conteudo = (conteudo or "").strip()

        if conteudo:
            path.write_text(conteudo, encoding="utf-8")
            log(f"🔥 TXT atualizado pela API: {path.name}")
        else:
            if path.exists():
                path.unlink()
                log(f"🧹 TXT removido porque a API retornou vazio: {path.name}")

    def preparar_txt_do_asset(src_path: Path | None, txt_path: Path, fallback_hexes: list[str]):
        if not src_path or not src_path.exists():
            return

        complementar_txt_com_cores_detectadas(src_path, txt_path, fallback_hexes)

        if not txt_path.exists() or not txt_path.read_text(encoding="utf-8").strip():
            for hx in fallback_hexes:
                if hx:
                    gerar_txt_automatico_por_cor_detectada(src_path, txt_path, hx)
                    break

    salvar_txt_api(moldura_txt, palette.get("txt_moldura", ""))
    salvar_txt_api(topo_txt, palette.get("txt_topo", ""))
    salvar_txt_api(faixa1_txt, palette.get("txt_faixa_principal", ""))
    salvar_txt_api(faixa2_txt, palette.get("txt_faixa_secundaria", ""))

    preparar_txt_do_asset(moldura_src, moldura_txt, [rgb_to_hex(cor_secundaria), rgb_to_hex(cor_primaria)])
    preparar_txt_do_asset(topo_src, topo_txt, [rgb_to_hex(cor_secundaria), rgb_to_hex(cor_primaria)])
    preparar_txt_do_asset(faixa1_src, faixa1_txt, [rgb_to_hex(cor_primaria), rgb_to_hex(cor_secundaria)])
    preparar_txt_do_asset(faixa2_src, faixa2_txt, [rgb_to_hex(cor_secundaria), rgb_to_hex(cor_primaria)])

    if moldura_src:
        aplicar_regras_txt(moldura_src, moldura_t, moldura_txt)
    if topo_src:
        aplicar_regras_txt(topo_src, topo_t, topo_txt)
    if faixa1_src:
        aplicar_regras_txt(faixa1_src, faixa1_t, faixa1_txt)
    if faixa2_src:
        aplicar_regras_txt(faixa2_src, faixa2_t, faixa2_txt)

    out_final_pedido = pedido_dir / "resultado_final.png"
    out_final_geral = OUT_DIR / f"resultado_{pedido_id}.png"

    MOLDURA_CFG = layout["moldura"]
    MOLDURA_X = int(MOLDURA_CFG["x"])
    MOLDURA_Y = int(MOLDURA_CFG["y"])
    if moldura_src and moldura_t.exists():
        moldura_size_ref = Image.open(moldura_t).convert("RGBA")
        MOLDURA_W_DEFAULT, MOLDURA_H_DEFAULT = moldura_size_ref.size
    elif moldura_src:
        moldura_size_ref = Image.open(moldura_src).convert("RGBA")
        MOLDURA_W_DEFAULT, MOLDURA_H_DEFAULT = moldura_size_ref.size
    else:
        MOLDURA_W_DEFAULT, MOLDURA_H_DEFAULT = W, H
    MOLDURA_W = int(MOLDURA_CFG.get("w", MOLDURA_W_DEFAULT))
    MOLDURA_H = int(MOLDURA_CFG.get("h", MOLDURA_H_DEFAULT))
    MOLDURA_OPACITY = float(MOLDURA_CFG.get("opacity", opacidade_secundaria))

    LOGO_CFG = layout["logo"]
    LOGO_X = int(LOGO_CFG["x"])
    LOGO_Y = int(LOGO_CFG["y"])
    LOGO_W = int(LOGO_CFG["w"])
    LOGO_VISIBLE = bool(LOGO_CFG.get("visible", True))

    ESCUDO2_CFG = layout.get("escudo2", {})
    ESCUDO2_X = int(ESCUDO2_CFG.get("x", 0))
    ESCUDO2_Y = int(ESCUDO2_CFG.get("y", 0))
    ESCUDO2_W = int(ESCUDO2_CFG.get("w", 350))
    ESCUDO2_VISIBLE = bool(ESCUDO2_CFG.get("visible", True)) and bool(escudo2)

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

    ESCUDO2_H = ESCUDO2_W
    if ESCUDO2_VISIBLE:
        escudo2_img = Image.open(escudo2).convert("RGBA")
        escudo2_h_original = escudo2_img.size[1]
        escudo2_w_original = escudo2_img.size[0]
        ESCUDO2_H = max(1, int(round(escudo2_h_original * (ESCUDO2_W / escudo2_w_original)))) if escudo2_w_original > 0 else ESCUDO2_W

    draw_ops = []

    if use_split_score:
        if TIME_PRINCIPAL_CFG.get("visible", True) and tp_fit["text"]:
            draw_ops.append(drawtext_block(
                text=tp_fit["text"],
                font_path=FONT_BOLD,
                font_size=tp_fit["font_size"],
                color_hex=rgb_to_hex(cor_texto_sec),
                x_expr=box_x_expr(int(TIME_PRINCIPAL_CFG["x"]), int(TIME_PRINCIPAL_CFG["w"]), TIME_PRINCIPAL_CFG.get("align", "center"), int(TIME_PRINCIPAL_CFG.get("pad_x", 0))),
                y_expr=box_y_expr(int(TIME_PRINCIPAL_CFG["y"]), int(TIME_PRINCIPAL_CFG["h"])),
                line_spacing=tp_fit["line_spacing"],
            ))

        if GOLS_TIME_CFG.get("visible", True) and gt_fit["text"]:
            draw_ops.append(drawtext_block(
                text=gt_fit["text"],
                font_path=FONT_BOLD,
                font_size=gt_fit["font_size"],
                color_hex=rgb_to_hex(cor_texto_sec),
                x_expr=box_x_expr(int(GOLS_TIME_CFG["x"]), int(GOLS_TIME_CFG["w"]), GOLS_TIME_CFG.get("align", "center"), int(GOLS_TIME_CFG.get("pad_x", 0))),
                y_expr=box_y_expr(int(GOLS_TIME_CFG["y"]), int(GOLS_TIME_CFG["h"])),
                line_spacing=gt_fit["line_spacing"],
            ))

        if PLACAR_X_CFG.get("visible", True) and px_fit["text"]:
            draw_ops.append(drawtext_block(
                text=px_fit["text"],
                font_path=FONT_BOLD,
                font_size=px_fit["font_size"],
                color_hex=rgb_to_hex(cor_texto_sec),
                x_expr=box_x_expr(int(PLACAR_X_CFG["x"]), int(PLACAR_X_CFG["w"]), PLACAR_X_CFG.get("align", "center"), int(PLACAR_X_CFG.get("pad_x", 0))),
                y_expr=box_y_expr(int(PLACAR_X_CFG["y"]), int(PLACAR_X_CFG["h"])),
                line_spacing=px_fit["line_spacing"],
            ))

        if GOLS_ADV_CFG.get("visible", True) and ga_fit["text"]:
            draw_ops.append(drawtext_block(
                text=ga_fit["text"],
                font_path=FONT_BOLD,
                font_size=ga_fit["font_size"],
                color_hex=rgb_to_hex(cor_texto_sec),
                x_expr=box_x_expr(int(GOLS_ADV_CFG["x"]), int(GOLS_ADV_CFG["w"]), GOLS_ADV_CFG.get("align", "center"), int(GOLS_ADV_CFG.get("pad_x", 0))),
                y_expr=box_y_expr(int(GOLS_ADV_CFG["y"]), int(GOLS_ADV_CFG["h"])),
                line_spacing=ga_fit["line_spacing"],
            ))

        if TIME_ADV_CFG.get("visible", True) and ta_fit["text"]:
            draw_ops.append(drawtext_block(
                text=ta_fit["text"],
                font_path=FONT_BOLD,
                font_size=ta_fit["font_size"],
                color_hex=rgb_to_hex(cor_texto_sec),
                x_expr=box_x_expr(int(TIME_ADV_CFG["x"]), int(TIME_ADV_CFG["w"]), TIME_ADV_CFG.get("align", "center"), int(TIME_ADV_CFG.get("pad_x", 0))),
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
            color_hex=rgb_to_hex(cor_texto),
            x_expr=box_x_expr(int(TITULO_CFG["x"]), int(TITULO_CFG["w"]), TITULO_CFG.get("align", "center"), int(TITULO_CFG.get("pad_x", 0))),
            y_expr=box_y_expr(int(TITULO_CFG["y"]), int(TITULO_CFG["h"])),
            line_spacing=titulo_fit["line_spacing"],
        ))

    if FRASE_CFG.get("visible", True) and frase_fit["text"]:
        draw_ops.append(drawtext_block(
            text=frase_fit["text"],
            font_path=FONT_BOLD,
            font_size=frase_fit["font_size"],
            color_hex=rgb_to_hex(cor_texto_sec),
            x_expr=box_x_expr(int(FRASE_CFG["x"]), int(FRASE_CFG["w"]), FRASE_CFG.get("align", "center"), int(FRASE_CFG.get("pad_x", 0))),
            y_expr=box_y_expr(int(FRASE_CFG["y"]), int(FRASE_CFG["h"])),
            line_spacing=frase_fit["line_spacing"],
        ))

    if ARTILHEIROS_CFG.get("visible", True) and artilheiros_fit["text"]:
        draw_ops.append(drawtext_block(
            text=artilheiros_fit["text"],
            font_path=FONT_REG,
            font_size=artilheiros_fit["font_size"],
            color_hex=rgb_to_hex(cor_texto_sec),
            x_expr=box_x_expr(int(ARTILHEIROS_CFG["x"]), int(ARTILHEIROS_CFG["w"]), ARTILHEIROS_CFG.get("align", "center"), int(ARTILHEIROS_CFG.get("pad_x", 0))),
            y_expr=box_y_expr(int(ARTILHEIROS_CFG["y"]), int(ARTILHEIROS_CFG["h"])),
            line_spacing=artilheiros_fit["line_spacing"],
        ))

    draw_chain = ",".join(draw_ops)

    filter_parts = [
        f"[0:v]scale={W}:{H},setsar=1[canvas0]",
        f"[1:v]eq=brightness={BG_BRIGHTNESS}:saturation={BG_SATURATION}:contrast={BG_CONTRAST},setsar=1[foto_src]"
    ]

    filter_parts.append(
        f"[foto_src]scale=w={photo_box_w}:h={photo_box_h}:force_original_aspect_ratio=decrease[foto_fit]"
    )
    
    input_index = 2
    current_base = "canvas0"
    overlay_count = 0

    if LOGO_VISIBLE:
        filter_parts.append(f"[{input_index}:v]scale={LOGO_W}:{LOGO_H}[esc]")
        input_index += 1

    if ESCUDO2_VISIBLE:
        filter_parts.append(f"[{input_index}:v]scale={ESCUDO2_W}:{ESCUDO2_H}[esc2]")
        input_index += 1

    if moldura_src and layout["moldura"].get("visible", True):
        filter_parts.append(f"[{input_index}:v]scale={MOLDURA_W}:{MOLDURA_H},format=rgba,colorchannelmixer=aa={MOLDURA_OPACITY:.3f}[mold]")
        input_index += 1

    if topo_src and layout["topo"].get("visible", True):
        filter_parts.append(f"[{input_index}:v]scale={TOPO_BOX_W}:{TOPO_BOX_H},format=rgba,colorchannelmixer=aa={opacidade_secundaria:.3f}[topo]")
        next_base = f"base{overlay_count + 1}"
        filter_parts.append(f"[{current_base}][topo]overlay={TOPO_BOX_X}:{TOPO_BOX_Y}[{next_base}]")
        current_base = next_base
        overlay_count += 1
        input_index += 1

    if faixa1_src and layout["faixa_principal"].get("visible", True):
        filter_parts.append(f"[{input_index}:v]scale={FAIXA1_W}:{FAIXA1_H},format=rgba,colorchannelmixer=aa={opacidade_primaria:.3f}[faixa1]")
        next_base = f"base{overlay_count + 1}"
        filter_parts.append(f"[{current_base}][faixa1]overlay={FAIXA1_X}:{FAIXA1_Y}[{next_base}]")
        current_base = next_base
        overlay_count += 1
        input_index += 1

    if faixa2_src and layout["faixa_secundaria"].get("visible", True):
        filter_parts.append(f"[{input_index}:v]scale={FAIXA2_W}:{FAIXA2_H},format=rgba,colorchannelmixer=aa={opacidade_secundaria:.3f}[faixa2]")
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

    if ESCUDO2_VISIBLE:
        next_base = f"base{overlay_count + 1}"
        filter_parts.append(f"[{current_base}][esc2]overlay={ESCUDO2_X}:{ESCUDO2_Y}[{next_base}]")
        current_base = next_base
        overlay_count += 1

    # FOTO
    next_base = f"base{overlay_count + 1}"
    filter_parts.append(
        f"[{current_base}][foto_fit]overlay="
        f"{photo_box_x}:"
        f"{photo_box_y}"
        f"[{next_base}]"
    )
    current_base = next_base
    overlay_count += 1

    # MOLDURA POR CIMA DA FOTO
    if moldura_src and layout["moldura"].get("visible", True):
        next_base = f"base{overlay_count + 1}"
        filter_parts.append(f"[{current_base}][mold]overlay={MOLDURA_X}:{MOLDURA_Y}[{next_base}]")
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
        "-i", str(bg_path),
        "-i", str(foto_jogo),
    ]

    if LOGO_VISIBLE:
        cmd += ["-i", str(escudo)]

    if ESCUDO2_VISIBLE:
        cmd += ["-i", str(escudo2)]

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
        "-update", "1",
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
        "opacidade_primaria": opacidade_primaria,
        "opacidade_secundaria": opacidade_secundaria,
        "font_style": font_style,
        "photo_mode": photo_mode,
        "photo_box_x": photo_box_x,
        "photo_box_y": photo_box_y,
        "photo_box_w": photo_box_w,
        "photo_box_h": photo_box_h,
        "background_prompt": bg_prompt,
        "background_negative_prompt": bg_negative_prompt,
        "background_gerado": str(bg_path),
        "txt_regras": {
            "moldura": str(moldura_txt),
            "topo": str(topo_txt),
            "faixa_principal": str(faixa1_txt),
            "faixa_secundaria": str(faixa2_txt),
        },
        "cores_detectadas_faixa_secundaria": detectar_cores_na_imagem(faixa2_src) if faixa2_src and faixa2_src.exists() else [],
        "cores_exatas_detectadas": {
            "moldura": detectar_cores_exatas_na_imagem(moldura_src) if moldura_src and moldura_src.exists() else [],
            "topo": detectar_cores_exatas_na_imagem(topo_src) if topo_src and topo_src.exists() else [],
            "faixa_principal": detectar_cores_exatas_na_imagem(faixa1_src) if faixa1_src and faixa1_src.exists() else [],
            "faixa_secundaria": detectar_cores_exatas_na_imagem(faixa2_src) if faixa2_src and faixa2_src.exists() else [],
        },
        "resultado_final": str(out_final_pedido),
        "resultado_copia": str(out_final_geral),
        "artilheiros_raw": artilheiros_raw,
        "artilheiros_processados": artilheiros,
        "artilheiros_texto": artilheiros_fit["text"],
        "layout_json": layout,
        "layout_renderizado": {
            "moldura": {"x": MOLDURA_X, "y": MOLDURA_Y, "w": MOLDURA_W, "h": MOLDURA_H, "visible": layout["moldura"].get("visible", True), "opacity": MOLDURA_OPACITY},
            "logo": {"x": LOGO_X, "y": LOGO_Y, "w": LOGO_W, "h": LOGO_H, "visible": LOGO_VISIBLE},
            "escudo2": {"x": ESCUDO2_X, "y": ESCUDO2_Y, "w": ESCUDO2_W, "h": ESCUDO2_H, "visible": ESCUDO2_VISIBLE},
            "topo_box": {"x": TOPO_BOX_X, "y": TOPO_BOX_Y, "w": TOPO_BOX_W, "h": TOPO_BOX_H, "visible": layout["topo"].get("visible", True)},
            "faixa_principal": {"x": FAIXA1_X, "y": FAIXA1_Y, "w": FAIXA1_W, "h": FAIXA1_H, "visible": layout["faixa_principal"].get("visible", True)},
            "faixa_secundaria": {"x": FAIXA2_X, "y": FAIXA2_Y, "w": FAIXA2_W, "h": FAIXA2_H, "visible": layout["faixa_secundaria"].get("visible", True)},
            "photo_box": {
                "mode": photo_mode,
                "x": photo_box_x,
                "y": photo_box_y,
                "w": photo_box_w,
                "h": photo_box_h
            },
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














