import json
import base64
import shutil
from io import BytesIO
from pathlib import Path
from datetime import datetime

import requests
from openai import OpenAI
from PIL import Image, ImageDraw, ImageFont

# =========================================================
# PIPELINE 100% CHATGPT API
# =========================================================
# Fluxo:
# site -> pasta do pedido -> ChatGPT API -> resultado_final.png -> site
#
# Este arquivo NÃO usa FFmpeg.
# Este arquivo NÃO monta a arte no computador.
# Ele apenas:
# 1) lê pedido.json
# 2) encontra imagens do pedido/template
# 3) escolhe o prompt .txt da categoria
# 4) envia referências + prompt para a API de imagem do ChatGPT
# 5) salva resultado_final.png
# 6) envia para o site
# =========================================================

BASE_DIR = Path(__file__).resolve().parent

TEMPLATE_DIR = BASE_DIR / "template_resultado"
TEMPLATE_ESCALACAO_DIR = BASE_DIR / "template_escalacao"
TEMPLATE_PROXIMO_JOGO_DIR = BASE_DIR / "template_proximo_jogo"
TEMPLATE_PATROCINADOR_DIR = BASE_DIR / "template_patrocinador"
TEMPLATE_PROXIMO_JOGO_JOGADOR_DIR = BASE_DIR / "template_proximo_jogo_jogador"
TEMPLATE_RESULTADO_JOGADOR_DIR = BASE_DIR / "template_resultado_jogador"
TEMPLATE_JOGADOR_ESCUDO_DIR = BASE_DIR / "template_jogador_escudo"

OUT_DIR = BASE_DIR / "resultados_prontos"
OUT_DIR.mkdir(exist_ok=True)

OPENAI_KEY_FILE = BASE_DIR / "openai_key.txt"
CREDENTIALS_FILE = BASE_DIR / "credenciais.txt"
PROMPT_IMAGEM_FILE = BASE_DIR / "prompt_imagem.txt"  # fallback antigo
PROMPT_FILES = {
    "resultado": BASE_DIR / "prompt_resultado.txt",
    "resultado_jogo": BASE_DIR / "prompt_resultado.txt",
    "resultado_do_jogo": BASE_DIR / "prompt_resultado.txt",
    "escalacao": BASE_DIR / "prompt_escalacao.txt",
    "proximo_jogo": BASE_DIR / "prompt_proximo_jogo.txt",
    "pronto_para_proximo_jogo": BASE_DIR / "prompt_proximo_jogo.txt",
    "artilheiro": BASE_DIR / "prompt_artilheiro.txt",
    "destaque": BASE_DIR / "prompt_destaque.txt",
    "destaque_do_jogo": BASE_DIR / "prompt_destaque.txt",
    "contratacao": BASE_DIR / "prompt_contratacao.txt",
    "patrocinador": BASE_DIR / "prompt_patrocinador.txt",
    "escudo3d": BASE_DIR / "prompt_escudo3d.txt",
    "proximo_jogo_jogador": BASE_DIR / "prompt_proximo_jogo_jogador.txt",
    "resultado_jogo_jogador": BASE_DIR / "prompt_resultado_jogador.txt",
    "jogador_escudo": BASE_DIR / "prompt_jogador_escudo.txt",
}

MODEL = "gpt-image-2"
SIZE = "1024x1536"
QUALITY = "medium"
INPUT_FIDELITY = "high"
OUTPUT_FORMAT = "jpeg"
N = 1
MODO = "normal"  # normal | barato | premium

if MODO == "barato":
    QUALITY = "low"
    SIZE = "1024x1536"
elif MODO == "premium":
    QUALITY = "high"
    SIZE = "1024x1536"

W_REF = 1024
H_REF = 1536
MAX_REFERENCIAS = 16

FONT_DIR = BASE_DIR / "fonts"


# =========================================================
# LOG / ARQUIVOS
# =========================================================

def log(msg: str):
    print(msg, flush=True)


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


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


def find_existing(folder: Path, names: list[str]) -> Path | None:
    for name in names:
        if not name:
            continue
        p = folder / str(name).strip()
        if p.exists() and p.is_file():
            return p
    return None


def optional_template_file(folder: Path, names: list[str]) -> Path | None:
    if not folder.exists():
        return None

    for name in names:
        p = folder / name
        if p.exists() and p.is_file():
            return p

    return None


def safe_json_list(value) -> list:
    if isinstance(value, list):
        return value

    if isinstance(value, str):
        value = value.strip()
        if not value:
            return []
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, list) else []
        except Exception:
            return []

    return []


import unicodedata

def normalize_text(value) -> str:
    texto = " ".join(str(value or "").replace("\r", "\n").split()).strip()
    return unicodedata.normalize("NFC", texto)


def is_image_file(path: Path) -> bool:
    return path.is_file() and path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}


# =========================================================
# PEDIDO / TEXTO
# =========================================================

def get_categoria(pedido: dict) -> str:
    return str(pedido.get("categoria", "")).strip().lower()


def build_score_text(pedido: dict) -> str:
    time_principal = normalize_text(pedido.get("time_principal", ""))
    time_adversario = normalize_text(pedido.get("time_adversario", ""))

    gols_time = str(pedido.get("gols_time_principal", "")).strip()
    gols_adv = str(pedido.get("gols_adversario", "")).strip()

    tem_placar = bool(time_principal or time_adversario or gols_time or gols_adv)

    if not tem_placar:
        return normalize_text(pedido.get("rodada", ""))

    if not gols_time:
        gols_time = "0"
    if not gols_adv:
        gols_adv = "0"

    if time_principal and time_adversario:
        return f"{time_principal} {gols_time} x {gols_adv} {time_adversario}"

    if time_principal:
        return f"{time_principal} {gols_time} x {gols_adv}"

    return f"{gols_time} x {gols_adv}"


def build_artilheiros_text(pedido: dict) -> list[str]:
    artilheiros = safe_json_list(pedido.get("artilheiros", []))
    linhas = []

    for item in artilheiros:
        if not isinstance(item, dict):
            continue

        nome = normalize_text(item.get("nome", ""))
        gols = normalize_text(item.get("gols", ""))

        if not nome:
            continue

        if gols:
            linhas.append(f"{nome} ({gols})")
        else:
            linhas.append(nome)

    return linhas


def build_jogadores_text(pedido: dict) -> list[str]:
    jogadores = safe_json_list(pedido.get("jogadores", []))
    linhas = []

    for item in jogadores:
        if not isinstance(item, dict):
            continue

        nome = normalize_text(item.get("nome", ""))
        posicao = normalize_text(item.get("posicao", ""))

        if nome and posicao:
            linhas.append(f"{nome} - {posicao}")
        elif nome:
            linhas.append(nome)
        elif posicao:
            linhas.append(posicao)

    return linhas


def corrigir_linhas_texto(linhas: list[str]) -> list[str]:
    linhas_originais = [normalize_text(l) for l in linhas if normalize_text(l)]

    if not linhas_originais:
        return linhas_originais

    try:
        client = OpenAI(api_key=load_api_key())

        prompt = f"""
Corrija apenas ortografia, acentuação e concordância básica das linhas abaixo.

REGRAS:
- NÃO invente informação nova.
- NÃO mude nomes próprios.
- NÃO mude nomes de times.
- NÃO resuma.
- NÃO traduza.
- NÃO coloque aspas.
- Mantenha a MESMA quantidade de linhas.
- Responda APENAS em JSON válido no formato:
{{"linhas":["linha 1","linha 2"]}}

LINHAS:
{json.dumps(linhas_originais, ensure_ascii=False)}
"""

        response = client.responses.create(
            model="gpt-5-mini",
            input=prompt
        )

        data = json.loads(response.output_text.strip())
        corrigidas = data.get("linhas", [])

        if not isinstance(corrigidas, list):
            return linhas_originais

        corrigidas = [normalize_text(l) for l in corrigidas]

        if len(corrigidas) != len(linhas_originais):
            return linhas_originais

        for original, corrigida in zip(linhas_originais, corrigidas):
            if not corrigida:
                return linhas_originais
            if len(corrigida) > len(original) * 1.8:
                return linhas_originais

        return corrigidas

    except Exception:
        return linhas_originais


def add_line(lines: list[str], text: str):
    text = normalize_text(text)
    if text and text not in lines:
        lines.append(text)


def texto_tem_horario(texto: str) -> bool:
    texto = normalize_text(texto).lower()
    if not texto:
        return False

    padroes = [
        "h da manhã",
        "h da manha",
        "hrs",
        "horas",
        "às ",
        "as ",
        ":"
    ]

    if any(p in texto for p in padroes):
        return any(ch.isdigit() for ch in texto)

    return False


def texto_parece_tipo_jogo(texto: str) -> bool:
    texto = normalize_text(texto).lower()
    if not texto:
        return False

    tipos = [
        "amistoso",
        "campeonato",
        "torneio",
        "copa",
        "final",
        "semifinal",
        "quartas",
        "rodada",
        "jogo treino",
        "jogo-treino"
    ]

    return any(tipo in texto for tipo in tipos)


def limpar_linhas_visuais(linhas: list[str]) -> list[str]:
    limpas = []
    tem_horario_em_linha_anterior = False

    for linha in linhas:
        linha = normalize_text(linha)
        if not linha:
            continue

        if texto_tem_horario(linha):
            if tem_horario_em_linha_anterior:
                continue
            tem_horario_em_linha_anterior = True

        if linha not in limpas:
            limpas.append(linha)

    return limpas


def build_text_lines(pedido: dict) -> list[str]:
    categoria = get_categoria(pedido)

    titulo_pedido = normalize_text(pedido.get("titulo", ""))
    rodada = normalize_text(pedido.get("rodada", ""))
    data = normalize_text(pedido.get("data", ""))
    hora = normalize_text(pedido.get("hora", ""))
    arena = normalize_text(pedido.get("arena", ""))
    frase = normalize_text(pedido.get("frase", ""))

    lines: list[str] = []

    if categoria == "resultado":
        add_line(lines, build_score_text(pedido))
        add_line(lines, rodada)
        add_line(lines, data)
        add_line(lines, hora)

        artilheiros = build_artilheiros_text(pedido)
        if artilheiros:
            add_line(lines, "Artilheiros:")
            for linha in artilheiros:
                add_line(lines, linha)

    elif categoria == "escalacao":
        add_line(lines, rodada)
        add_line(lines, data)
        add_line(lines, hora)
        add_line(lines, arena)

        jogadores = build_jogadores_text(pedido)
        for jogador in jogadores:
            add_line(lines, jogador)

    elif categoria == "contratacao":
        add_line(lines, rodada)
        add_line(lines, data)
        add_line(lines, hora)

    elif categoria == "proximo_jogo":

        time_principal = normalize_text(pedido.get("time_principal", ""))
        time_adversario = normalize_text(pedido.get("time_adversario", ""))

        if time_principal and time_adversario:
            add_line(lines, f"{time_principal} x {time_adversario}")
        else:
            add_line(lines, rodada)
            add_line(lines, time_principal)
            add_line(lines, time_adversario)

        add_line(lines, data)
        if not texto_tem_horario(data) or texto_parece_tipo_jogo(hora):
            add_line(lines, hora)
        add_line(lines, arena)

    elif categoria == "proximo_jogo_jogador":
        time_principal = normalize_text(pedido.get("time_principal", ""))
        time_adversario = normalize_text(pedido.get("time_adversario", ""))

        if time_principal and time_adversario:
            add_line(lines, f"{time_principal} x {time_adversario}")
        else:
            add_line(lines, rodada)
            add_line(lines, time_principal)
            add_line(lines, time_adversario)

        add_line(lines, data)
        if not texto_tem_horario(data) or texto_parece_tipo_jogo(hora):
            add_line(lines, hora)
        add_line(lines, arena)

    elif categoria == "resultado_jogo_jogador":
        add_line(lines, build_score_text(pedido))
        add_line(lines, rodada)
        add_line(lines, data)
        add_line(lines, hora)

    elif categoria == "jogador_escudo":
        add_line(lines, data)
        add_line(lines, rodada)

        jogadores = build_jogadores_text(pedido)
        for jogador in jogadores:
            add_line(lines, jogador)

    elif categoria == "patrocinador":
        add_line(lines, rodada)
        add_line(lines, data)

    elif categoria == "escudo3d":
        pass

    else:
        add_line(lines, rodada)
        add_line(lines, data)
        add_line(lines, frase)

    return limpar_linhas_visuais(lines)


def load_font(size: int, bold: bool = False):
    candidates = []

    if bold:
        candidates.extend([
            FONT_DIR / "Anton-Regular.ttf",
            FONT_DIR / "Montserrat-Bold.ttf",
            FONT_DIR / "Montserrat[wght].ttf",
        ])

    candidates.extend([
        FONT_DIR / "Montserrat.ttf",
        FONT_DIR / "Montserrat-Regular.ttf",
        FONT_DIR / "BebasNeue-Regular.ttf",
        Path("C:/Windows/Fonts/arialbd.ttf") if bold else Path("C:/Windows/Fonts/arial.ttf"),
    ])

    for path in candidates:
        try:
            if path.exists():
                return ImageFont.truetype(str(path), size=size)
        except Exception:
            pass

    return ImageFont.load_default()


def wrap_text(draw: ImageDraw.ImageDraw, text: str, font, max_width: int) -> list[str]:
    words = str(text or "").split()
    if not words:
        return []

    lines = []
    current = ""

    for word in words:
        candidate = word if not current else f"{current} {word}"
        bbox = draw.textbbox((0, 0), candidate, font=font)
        w = bbox[2] - bbox[0]

        if w <= max_width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word

    if current:
        lines.append(current)

    return lines


def render_text_reference_image(lines: list[str], output_path: Path):
    img = Image.new("RGB", (W_REF, H_REF), (0, 0, 0))
    draw = ImageDraw.Draw(img)

    margin_x = 70
    y = 70
    max_width = W_REF - (margin_x * 2)

    title_font = load_font(58, bold=True)
    body_font = load_font(34, bold=True)
    small_font = load_font(28, bold=False)

    for idx, line in enumerate(lines):
        if y > H_REF - 90:
            break

        font = title_font if idx == 0 else body_font
        line_spacing = 12 if idx == 0 else 8

        wrapped = wrap_text(draw, line, font, max_width)

        for subline in wrapped:
            bbox = draw.textbbox((0, 0), subline, font=font)
            w = bbox[2] - bbox[0]
            h = bbox[3] - bbox[1]

            x = int((W_REF - w) / 2)
            draw.text((x, y), subline, font=font, fill=(255, 255, 255))

            y += h + line_spacing

        if idx == 0:
            y += 28
        else:
            y += 10

    if y > H_REF - 120:
        aviso = "Texto extra cortado por limite visual."
        draw.text((margin_x, H_REF - 70), aviso, font=small_font, fill=(255, 255, 255))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(output_path)


# =========================================================
# PROMPT
# =========================================================

DEFAULT_PROMPT_IMAGEM = ""


def ensure_prompt_file():
    return


def prompt_file_for_categoria(categoria: str) -> Path:
    categoria = normalize_text(categoria).lower().replace("-", "_").replace(" ", "_")
    return PROMPT_FILES.get(categoria, PROMPT_IMAGEM_FILE)


def load_prompt_imagem(pedido: dict, linhas_texto: list[str]) -> tuple[str, Path]:
    categoria = get_categoria(pedido)
    prompt_file = prompt_file_for_categoria(categoria)

    # Compatibilidade: se ainda não existir o txt específico, usa o prompt_imagem.txt antigo.
    if not prompt_file.exists() and PROMPT_IMAGEM_FILE.exists():
        prompt_file = PROMPT_IMAGEM_FILE

    if not prompt_file.exists():
        raise FileNotFoundError(
            f"Não achei o prompt da categoria '{categoria}'. Crie {prompt_file.name} na pasta do script."
        )

    prompt = prompt_file.read_text(encoding="utf-8", errors="ignore").strip()
    if not prompt:
        raise ValueError(f"{prompt_file.name} está vazio.")

    return prompt, prompt_file


# =========================================================
# REFERÊNCIAS DE IMAGEM
# =========================================================

TEMPLATE_CONTRATACAO_DIR = BASE_DIR / "template_contratacao"

def template_dir_for_categoria(categoria: str) -> Path:
    if categoria == "escalacao":
        return TEMPLATE_ESCALACAO_DIR
    if categoria == "proximo_jogo":
        return TEMPLATE_PROXIMO_JOGO_DIR
    if categoria == "proximo_jogo_jogador":
        return TEMPLATE_PROXIMO_JOGO_JOGADOR_DIR if TEMPLATE_PROXIMO_JOGO_JOGADOR_DIR.exists() else TEMPLATE_PROXIMO_JOGO_DIR
    if categoria == "resultado_jogo_jogador":
        return TEMPLATE_RESULTADO_JOGADOR_DIR if TEMPLATE_RESULTADO_JOGADOR_DIR.exists() else TEMPLATE_DIR
    if categoria == "jogador_escudo":
        return TEMPLATE_JOGADOR_ESCUDO_DIR if TEMPLATE_JOGADOR_ESCUDO_DIR.exists() else TEMPLATE_DIR
    if categoria == "patrocinador":
        return TEMPLATE_PATROCINADOR_DIR
    if categoria == "contratacao":
        return TEMPLATE_CONTRATACAO_DIR
    return TEMPLATE_DIR


def find_core_assets(pedido_dir: Path, pedido: dict) -> dict:
    foto = None
    escudo = None
    escudo2 = None

    foto_nome = normalize_text(pedido.get("foto_jogo", "")) or normalize_text(pedido.get("foto", ""))
    escudo_nome = normalize_text(pedido.get("escudo_principal", ""))
    escudo2_nome = normalize_text(pedido.get("escudo2", "")) or normalize_text(pedido.get("escudo_adversario", ""))

    if foto_nome:
        foto = find_existing(pedido_dir, [foto_nome])
    if escudo_nome:
        escudo = find_existing(pedido_dir, [escudo_nome])
    if escudo2_nome:
        escudo2 = find_existing(pedido_dir, [escudo2_nome])

    if not foto:
        foto = find_existing(
            pedido_dir,
            [
                "foto_jogo.png", "foto_jogo.jpg", "foto_jogo.jpeg", "foto_jogo.webp",
                "foto.png", "foto.jpg", "foto.jpeg", "foto.webp"
            ]
        )

    if not escudo:
        escudo = find_existing(
            pedido_dir,
            [
                "escudo_principal_sem_fundo.png", "escudo_principal.png",
                "escudo_principal.jpg", "escudo_principal.jpeg", "escudo_principal.webp",
                "escudo1_sem_fundo.png", "escudo1.png", "escudo1.jpg", "escudo1.jpeg", "escudo1.webp"
            ]
        )

    if not escudo2:
        escudo2 = find_existing(
            pedido_dir,
            [
                "escudo2_sem_fundo.png", "escudo2.png", "escudo2.jpg", "escudo2.jpeg", "escudo2.webp",
                "escudo_adversario_sem_fundo.png", "escudo_adversario.png",
                "escudo_adversario.jpg", "escudo_adversario.jpeg", "escudo_adversario.webp"
            ]
        )

    return {
        "foto": foto,
        "escudo": escudo,
        "escudo2": escudo2,
    }


def find_patrocinadores(pedido_dir: Path) -> list[Path]:
    arquivos = []

    for i in range(1, 21):
        pid = f"patrocinador_{i}"
        found = find_existing(
            pedido_dir,
            [
                f"{pid}.png", f"{pid}.jpg", f"{pid}.jpeg", f"{pid}.webp",
                f"patrocinador{i}.png", f"patrocinador{i}.jpg", f"patrocinador{i}.jpeg", f"patrocinador{i}.webp",
                f"pat{i:02d}.png", f"pat{i:02d}.jpg", f"pat{i:02d}.jpeg", f"pat{i:02d}.webp",
                f"pat{i}.png", f"pat{i}.jpg", f"pat{i}.jpeg", f"pat{i}.webp",
            ]
        )

        if found:
            arquivos.append(found)

    return arquivos


def collect_template_refs(template_dir: Path) -> list[Path]:
    refs = []

    for names in [
        ["moldura.png", "moldura.jpg", "moldura.jpeg", "moldura.webp"],
        ["topo_barra.png", "topo_barra.jpg", "topo_barra.jpeg", "topo_barra.webp", "topo.png", "topo.jpg"],
        ["faixa_principal.png", "faixa_principal.jpg", "faixa_principal.jpeg", "faixa_principal.webp"],
        ["faixa_secundaria.png", "faixa_secundaria.jpg", "faixa_secundaria.jpeg", "faixa_secundaria.webp"],
    ]:
        found = optional_template_file(template_dir, names)
        if found:
            refs.append(found)

    return refs


def collect_extra_images(pedido_dir: Path, already: set[Path]) -> list[Path]:
    extras = []

    for path in sorted(pedido_dir.iterdir()):
        if not is_image_file(path):
            continue

        resolved = path.resolve()
        if resolved in already:
            continue

        name = path.name.lower()
        if name.startswith("resultado_") or name in {"resultado_final.png", "resultado_final.jpg"}:
            continue

        if "_resultado_temp" in str(path):
            continue

        extras.append(path)

    return extras


def unique_append(lista: list[Path], path: Path | None, seen: set[Path]):
    if not path:
        return

    if not path.exists() or not path.is_file():
        return

    resolved = path.resolve()
    if resolved in seen:
        return

    lista.append(path)
    seen.add(resolved)


def build_reference_images(pedido_dir: Path, pedido: dict, text_ref_path: Path) -> list[Path]:
    categoria = get_categoria(pedido)
    template_dir = template_dir_for_categoria(categoria)
    assets = find_core_assets(pedido_dir, pedido)

    refs: list[Path] = []
    seen: set[Path] = set()

    # Ordem importante: em gpt-image-1.5, as primeiras referências têm mais peso.
    pedido_layout_img = pedido_dir / "pedido.png"
    unique_append(refs, pedido_layout_img, seen)
    # imagem de texto não vai para a API
    unique_append(refs, assets.get("escudo"), seen)
    unique_append(refs, assets.get("escudo2"), seen)
    unique_append(refs, assets.get("foto"), seen)

    for p in collect_template_refs(template_dir):
        unique_append(refs, p, seen)

    for p in find_patrocinadores(pedido_dir):
        unique_append(refs, p, seen)

    for p in collect_extra_images(pedido_dir, seen):
        unique_append(refs, p, seen)

    if len(refs) > MAX_REFERENCIAS:
        log(f"⚠️ Foram encontradas {len(refs)} imagens. Enviarei só as primeiras {MAX_REFERENCIAS}.")
        refs = refs[:MAX_REFERENCIAS]

    return refs


# =========================================================
# OPENAI IMAGE
# =========================================================

def render_via_chatgpt_api(output_path: Path, prompt: str, arquivos_referencia: list[Path]):
    api_key = load_api_key()
    client = OpenAI(api_key=api_key)

    image_files = []

    try:
        for caminho in arquivos_referencia:
            if caminho and caminho.exists():
                try:
                    img = Image.open(caminho)

                    if img.mode != "RGB":
                        temp_path = caminho.with_suffix(".tmp.png")
                        img.convert("RGB").save(temp_path, "PNG")
                        image_files.append(open(temp_path, "rb"))
                    else:
                        image_files.append(open(caminho, "rb"))

                except Exception:
                    log(f"⚠️ Ignorando imagem inválida: {caminho}")

        if not image_files:
            raise ValueError("Nenhuma imagem de referência encontrada para enviar ao ChatGPT API.")

        log(f"🚀 Enviando {len(image_files)} imagens para ChatGPT API...")
        log(f"🧠 Modelo: {MODEL} | Size: {SIZE} | Quality: {QUALITY} | Formato API: {OUTPUT_FORMAT}")

        result = client.images.edit(
            model=MODEL,
            image=image_files,
            prompt=prompt,
            size=SIZE,
            quality=QUALITY,
            output_format=OUTPUT_FORMAT,
            n=N,
        )

        imagem_b64 = result.data[0].b64_json
        imagem_bytes = base64.b64decode(imagem_b64)

        raw_path = output_path.with_suffix(f".raw.{OUTPUT_FORMAT}")
        raw_path.write_bytes(imagem_bytes)

        # Mantém compatibilidade com o site antigo: resultado_final.png.
        try:
            img = Image.open(BytesIO(imagem_bytes)).convert("RGB")
            img.save(output_path, "PNG")
        except Exception:
            output_path.write_bytes(imagem_bytes)

        log(f"✅ Resultado salvo em: {output_path}")

    finally:
        for f in image_files:
            try:
                f.close()
            except Exception:
                pass


# =========================================================
# UPLOAD SITE
# =========================================================

def upload_resultado_para_site(pedido_dir: Path, pedido_id: str, imagem_path: Path):
    pedido_json = pedido_dir / "pedido.json"
    if not pedido_json.exists():
        raise FileNotFoundError("pedido.json não encontrado para upload do resultado.")

    pedido = load_json(pedido_json)
    whatsapp = normalize_text(pedido.get("whatsapp", ""))

    if not whatsapp:
        raise ValueError("whatsapp não encontrado no pedido.json.")

    whatsapp_login, senha_login = load_credentials()

    log("🔐 Fazendo login no site...")

    login_resp = requests.post(
        "https://api.omascote.com.br/auth/login",
        json={
            "whatsapp": whatsapp_login,
            "senha": senha_login,
        },
        timeout=60,
    )

    if login_resp.status_code != 200:
        raise RuntimeError(f"Falha no login da API: {login_resp.status_code} | {login_resp.text[:500]}")

    login_data = login_resp.json()
    token = str(login_data.get("token", "")).strip()

    if not token:
        raise RuntimeError("Login da API não retornou token.")

    log("📤 Enviando resultado para o site...")

    with open(imagem_path, "rb") as f:
        up_resp = requests.post(
            f"https://api.omascote.com.br/bot/pedidos/{pedido_id}/upload-resultado",
            headers={
                "Authorization": f"Bearer {token}",
            },
            files={
                "resultado": ("resultado_final.png", f, "image/png"),
            },
            data={
                "descricao_instagram": pedido.get("descricao_instagram", "")
            },
            timeout=180,
        )

    if up_resp.status_code != 200:
        raise RuntimeError(f"Falha ao enviar resultado: {up_resp.status_code} | {up_resp.text[:500]}")

    log("✅ Resultado enviado para o site com sucesso.")


# =========================================================
# MAIN
# =========================================================

def main():
    import sys

    if len(sys.argv) < 2:
        raise SystemExit("Uso: python resultado_pipeline_api_only.py <PASTA_DO_PEDIDO>")

    pedido_dir = Path(sys.argv[1]).resolve()
    if not pedido_dir.exists():
        raise SystemExit(f"Pasta não encontrada: {pedido_dir}")

    pedido_json = pedido_dir / "pedido.json"
    if not pedido_json.exists():
        raise SystemExit("pedido.json não encontrado.")

    pedido = load_json(pedido_json)
    pedido_id = normalize_text(pedido.get("id", "sem_id")) or "sem_id"

    temp_dir = pedido_dir / "_resultado_api_temp"
    if temp_dir.exists():
        shutil.rmtree(temp_dir)
    temp_dir.mkdir(parents=True, exist_ok=True)

    out_final_pedido = pedido_dir / "resultado_final.png"
    out_final_geral = OUT_DIR / f"resultado_{pedido_id}.png"

    linhas_texto = []

    texto_ref_path = temp_dir / "texto_referencia_chatgpt.png"

    linhas_texto = build_text_lines(pedido)
    linhas_texto = corrigir_linhas_texto(linhas_texto)

    prompt_base, prompt_file_usado = load_prompt_imagem(pedido, linhas_texto)

    texto_formatado = "\n".join(linhas_texto)

    prompt = f"""{prompt_base}

DADOS DO PEDIDO:
Use as informações abaixo como referência principal do pedido.
Organize visualmente de forma limpa, profissional e sem poluição.
Evite repetir informações equivalentes.
Se uma linha já contém data e horário juntos, NÃO repita o horário em outro lugar.
Se o tipo do jogo aparecer como AMISTOSO, CAMPEONATO, COPA ou TORNEIO, use como título ou detalhe pequeno, sem repetir.
Não transforme todas as informações em texto grande.
Priorize escudos, confronto, data, horário e local de forma equilibrada.

INFORMAÇÕES DO CLIENTE:
{texto_formatado}

REGRAS CRÍTICAS DE INTERPRETAÇÃO:
- Se algum campo estiver vazio, NÃO invente informação.
- Se algum campo estiver vazio, NÃO criar texto substituto.
- NÃO adicionar campeonato, horário, data, cidade ou patrocinador não informado.
- NÃO preencher automaticamente informações ausentes.
- Use SOMENTE as informações realmente presentes no pedido.
- Se faltar informação, apenas omita visualmente.
- NÃO criar frases genéricas para compensar campos vazios.
"""

    log(f"📝 Prompt usado: {prompt_file_usado.name}")

    referencias = build_reference_images(pedido_dir, pedido, texto_ref_path)
    if not referencias:
        raise RuntimeError("Nenhuma referência visual encontrada.")

    log("📦 Referências enviadas:")
    for idx, ref in enumerate(referencias, start=1):
        log(f"   {idx:02d}. {ref}")

    render_via_chatgpt_api(out_final_pedido, prompt, referencias)

    shutil.copy2(out_final_pedido, out_final_geral)
    log(f"✅ Cópia salva em: {out_final_geral}")

    info = {
        "pedido_id": pedido_id,
        "modelo": MODEL,
        "size": SIZE,
        "quality": QUALITY,
        "input_fidelity": INPUT_FIDELITY,
        "output_format_api": OUTPUT_FORMAT,
        "resultado_final": str(out_final_pedido),
        "resultado_copia": str(out_final_geral),
        "prompt_file": str(prompt_file_usado),
        "texto_referencia": "",
        "linhas_texto": linhas_texto,
        "referencias": [str(p) for p in referencias],
        "gerado_em": datetime.now().isoformat(timespec="seconds"),
    }

    (pedido_dir / "resultado_api_info.json").write_text(
        json.dumps(info, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    log("⚠️ Validador desativado - seguindo sem validação")

    descricao = gerar_descricao_instagram(pedido, linhas_texto)

    try:
        pedido["descricao_instagram"] = descricao
        (pedido_dir / "pedido.json").write_text(
            json.dumps(pedido, ensure_ascii=False, indent=2),
            encoding="utf-8"
        )
    except Exception:
        pass

    upload_resultado_para_site(pedido_dir, pedido_id, out_final_pedido)
    (pedido_dir / "processado_handoff.txt").write_text("OK", encoding="utf-8")


def gerar_descricao_instagram(pedido, linhas_texto):
    try:
        client = OpenAI(api_key=load_api_key())

        prompt = f"""
ESCREVA TODO O TEXTO EM PORTUGUÊS (BRASIL)

Crie uma legenda para Instagram baseada no conteúdo da arte.

A arte pode ser:
- resultado
- contratação
- escalação
- próximo jogo
- patrocinador
- próximo jogo jogador
- resultado jogador
- jogador + escudo

Use o texto da arte como base principal.

TEXTO DA ARTE:
{chr(10).join(linhas_texto)}

REGRAS IMPORTANTES:
- Identifique automaticamente o tipo da arte pelo texto (ex: CONTRATAÇÃO, RESULTADO, ESCALAÇÃO)
- NÃO pedir mais informações
- NÃO fazer perguntas
- NÃO assumir que falta dado
- Sempre gerar a legenda com base no que já foi fornecido

Regras:
- Texto leve, natural e simples (não exagerado, não muito emocional)
- Evitar tom de torcida exagerada ou frases dramáticas
- Parecer uma legenda comum de time (humano, direto)
- Máximo 6 linhas
- CTA leve e opcional (sem pressão)
- Incluir hashtags no final
- SEMPRE incluir obrigatoriamente a hashtag #ia4tube na última linha
- Não inventar informações

Formato:
Texto + quebra de linha + hashtags
"""

        response = client.responses.create(
            model="gpt-5-mini",
            input=prompt
        )

        return response.output_text.strip()

    except Exception:
        return ""

def validar_imagem(imagem_path, linhas_texto, pedido):
    try:
        api_key = load_api_key()
        client = OpenAI(api_key=api_key)

        categoria = get_categoria(pedido)

        with open(imagem_path, "rb") as f:
            img_bytes = f.read()

        if categoria == "escudo3d":
            checklist = [
                "A imagem final mostra um escudo como elemento principal?",
                "O escudo ficou com aparência 3D/profissional?",
                "O escudo mantém identidade visual parecida com o escudo enviado?",
                "A imagem não está quebrada, borrada demais, deformada ou muito feia?",
                "Não existe texto errado, palavra aleatória ou erro de escrita visível?"
            ]
        elif categoria == "resultado":
            checklist = [
                "O placar/time/resultado está correto conforme o pedido?",
                "Os nomes dos times aparecem corretos?",
                "A frase/texto principal está sem erro evidente?",
                "A imagem está bonita e pronta para postar?",
                "Escudos/foto não parecem trocados ou errados?"
            ]
        elif categoria == "resultado_jogo_jogador":
            checklist = [
                "A arte representa um resultado de jogo com foco no jogador?",
                "O placar/time/resultado está correto conforme o pedido?",
                "A foto do jogador aparece como destaque ou referência principal?",
                "A frase/texto principal está sem erro evidente?",
                "A imagem está bonita e pronta para postar?"
            ]
        elif categoria == "escalacao":
            checklist = [
                "A imagem representa uma escalação?",
                "Os nomes dos jogadores aparecem corretos quando visíveis?",
                "Não há erro evidente de texto ou nomes?",
                "O escudo/time parece correto?",
                "A imagem está bonita e pronta para postar?"
            ]
        elif categoria == "contratacao":
            checklist = [
                "O nome principal do jogador está correto conforme o pedido?",
                "A arte representa uma contratação de forma clara?",
                "O escudo do time está correto?",
                "A imagem está bonita e pronta para postar?",
                "A imagem não está quebrada, deformada ou muito feia?"
            ]
        elif categoria == "proximo_jogo_jogador":
            checklist = [
                "A arte representa um próximo jogo com foco no jogador?",
                "Os times/confronto aparecem corretos conforme o pedido?",
                "A foto do jogador aparece como destaque ou referência principal?",
                "Data, horário e competição estão sem erro evidente?",
                "A imagem está bonita e pronta para postar?"
            ]
        elif categoria == "jogador_escudo":
            checklist = [
                "A arte tem foco no jogador e no escudo do time?",
                "O nome do jogador está correto conforme o pedido?",
                "A foto do jogador aparece como destaque ou referência principal?",
                "O escudo do time parece correto?",
                "A imagem está bonita e pronta para postar?"
            ]

        else:
            checklist = [
                "O texto principal está correto conforme o pedido?",
                "Não há erro evidente de ortografia ou nomes?",
                "As imagens/escudos parecem coerentes com o pedido?",
                "A arte está bonita e pronta para postar?",
                "A imagem não está quebrada, deformada ou muito feia?"
            ]

        prompt = f"""
Você é um validador comercial de artes esportivas.

Analise a imagem e responda APENAS em JSON válido, sem markdown.

Formato obrigatório:
{{
  "aprovado": true,
  "motivo": "explicação curta",
  "categoria": "{categoria}",
  "itens": [
    {{
      "item": "nome do item avaliado",
      "aprovado": true,
      "observacao": "curto"
    }}
  ]
}}

Categoria do pedido:
{categoria}

Texto esperado:
{chr(10).join(linhas_texto)}

Checklist obrigatório:
{chr(10).join("- " + item for item in checklist)}

Critério:
- Reprove se existir erro claro que um cliente perceberia.
- Aprove se estiver bom o suficiente para vender.
- Pequenas imperfeições visuais são aceitáveis.
- Texto errado, nome errado ou palavra estranha deve reprovar.
- EXCEÇÃO PARA CONTRATAÇÃO: ignore completamente nomes que aparecem em uniforme, camisa, roupa ou detalhes visuais do jogador.
- Para contratação, valide apenas o nome principal exibido na arte, ou seja, o nome anunciado em destaque.
- REGRA ESPECIAL PARA NOMES EM ESCUDOS: se o nome escrito no escudo for diferente do nome digitado no pedido, o nome do escudo é a fonte mais importante e deve ser considerado correto.
- Não reprove por diferença pequena entre o nome digitado e o nome oficial visível no escudo, como SÃO LUIS x SÃO LUIZ, desde que o escudo pareça ser o correto.
"""

        response = client.responses.create(
            model="gpt-5-mini",
            input=[{
                "role": "user",
                "content": [
                    {"type": "input_text", "text": prompt},
                    {
                        "type": "input_image",
                        "image_url": "data:image/png;base64," + base64.b64encode(img_bytes).decode()
                    }
                ]
            }]
        )

        text = response.output_text.strip()

        try:
            data = json.loads(text)
            aprovado = bool(data.get("aprovado", False))
            motivo = str(data.get("motivo", "sem motivo"))
            return aprovado, motivo, data
        except Exception:
            return False, "erro ao interpretar resposta da IA", {
                "aprovado": False,
                "motivo": "erro ao interpretar resposta da IA",
                "resposta_bruta": text
            }

    except Exception as e:
        return False, f"erro no validador: {e}", {
            "aprovado": False,
            "motivo": f"erro no validador: {e}"
        }


if __name__ == "__main__":
    main()






