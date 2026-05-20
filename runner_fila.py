import subprocess
import time
import json
import os
import math
import urllib.request
from pathlib import Path
from datetime import datetime

BASE_DIR = Path(r"C:\Users\USER\Desktop\resultado\IA4tube")
PEDIDOS_DIR = BASE_DIR / "Pedidos"
PIPELINE = BASE_DIR / "resultado_pipeline.py"

MAX_PROCESSOS = 10
INTERVALO_SEGUNDOS = 5

ESTADO_FILE = BASE_DIR / "runner_estado.json"
TEMPOS_FILE = BASE_DIR / "runner_tempos.json"
INICIAR_A_PARTIR_DE = "20260428_182150"

API_BASE = os.environ.get("OMASCOTE_API_BASE", "https://api.omascote.com.br").rstrip("/")
BOT_TOKEN_FILE = BASE_DIR / "bot_token.txt"
TEMPO_PADRAO_SEGUNDOS = 0
HISTORICO_TEMPOS_MAX = 20

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)

def carregar_ultimo_pedido():
    if not ESTADO_FILE.exists():
        return INICIAR_A_PARTIR_DE

    try:
        data = json.loads(ESTADO_FILE.read_text(encoding="utf-8"))
        return str(data.get("ultimo_pedido_visto", INICIAR_A_PARTIR_DE)).strip() or INICIAR_A_PARTIR_DE
    except Exception:
        return INICIAR_A_PARTIR_DE

def salvar_ultimo_pedido(nome_pedido):
    ESTADO_FILE.write_text(
        json.dumps({"ultimo_pedido_visto": nome_pedido}, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

def carregar_bot_token():
    token = os.environ.get("OMASCOTE_BOT_TOKEN", "").strip()
    if token:
        return token

    if BOT_TOKEN_FILE.exists():
        try:
            return BOT_TOKEN_FILE.read_text(encoding="utf-8").strip()
        except Exception:
            return ""

    return ""

def carregar_tempos():
    if not TEMPOS_FILE.exists():
        return []

    try:
        data = json.loads(TEMPOS_FILE.read_text(encoding="utf-8"))
        tempos = data.get("tempos_segundos", [])
        return [float(t) for t in tempos if float(t) > 0][-HISTORICO_TEMPOS_MAX:]
    except Exception:
        return []

def salvar_tempos(tempos):
    TEMPOS_FILE.write_text(
        json.dumps({"tempos_segundos": tempos[-HISTORICO_TEMPOS_MAX:]}, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

def registrar_tempo_pedido(segundos):
    if segundos <= 0:
        return

    tempos = carregar_tempos()
    tempos.append(round(float(segundos), 2))
    salvar_tempos(tempos)

def calcular_tempo_estimado(qtd_pedidos):
    tempos = carregar_tempos()

    if not tempos:
        media = 0
    else:
        ultimo = tempos[-1]

        if ultimo <= 120:
            media = ultimo
        else:
            ultimos_5 = tempos[-5:]
            media = sum(ultimos_5) / len(ultimos_5)

    lotes = max(1, math.ceil(max(1, qtd_pedidos) / MAX_PROCESSOS))
    estimado = int(round(media * lotes)) if media > 0 else 0

    return {
        "aprendendo": len(tempos) == 0,
        "tempo_medio_segundos": int(round(media)),
        "tempo_estimado_segundos": estimado,
        "pedidos_na_fila": int(qtd_pedidos),
        "lotes": int(lotes),
        "max_processos": int(MAX_PROCESSOS),
        "atualizado_em": datetime.now().isoformat()
    }

def enviar_tempo_est_api(payload):
    token = carregar_bot_token()
    if not token:
        return

    try:
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"{API_BASE}/bot/tempo-estimado",
            data=body,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            },
            method="POST"
        )
        urllib.request.urlopen(req, timeout=5).read()
    except Exception as e:
        log(f"⚠️ Erro ao enviar tempo estimado para API: {e}")

def avisar_erro_pedido_api(pasta, motivo):
    token = carregar_bot_token()
    if not token:
        log("⚠️ Sem bot_token.txt: não consegui avisar suporte no site.")
        return

    try:
        pedido_path = pasta / "pedido.json"
        if not pedido_path.exists():
            log("⚠️ pedido.json não encontrado para avisar suporte.")
            return

        pedido = json.loads(pedido_path.read_text(encoding="utf-8"))
        pedido_id = str(pedido.get("id", pasta.name)).strip()
        whatsapp = str(pedido.get("whatsapp", "")).strip()

        if not whatsapp:
            log("⚠️ WhatsApp não encontrado no pedido.json.")
            return

        payload = {
            "pedido_id": pedido_id,
            "whatsapp": whatsapp,
            "motivo": motivo
        }

        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")

        req = urllib.request.Request(
            f"{API_BASE}/bot/suporte/erro-pedido",
            data=body,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            },
            method="POST"
        )

        urllib.request.urlopen(req, timeout=10).read()
        log(f"📩 Suporte avisado no site: {pedido_id}")

    except Exception as e:
        log(f"⚠️ Erro ao avisar suporte no site: {e}")

def pedido_pendente(pasta, ultimo_pedido):
    if not pasta.is_dir():
        return False

    if not (pasta / "pedido.json").exists():
        return False

    ajuste_pendente_file = pasta / "ajuste_pendente.txt"
    status_file = pasta / "status.txt"

    status = ""
    if status_file.exists():
        try:
            status = status_file.read_text(encoding="utf-8", errors="ignore").strip().lower()
        except Exception:
            status = ""

    eh_ajuste = ajuste_pendente_file.exists() or status == "ajuste_pendente"

    if not eh_ajuste and pasta.name <= ultimo_pedido:
        return False

    if not eh_ajuste and (pasta / "resultado_final.png").exists():
        return False

    if (pasta / "erro_validacao.txt").exists():
        return False

    if (pasta / "erro_runner.txt").exists():
        return False

    if (pasta / "processando.lock").exists():
        return False

    if not eh_ajuste and (pasta / "processado_handoff.txt").exists():
        return False

    return True

def pegar_pendentes():
    ultimo_pedido = carregar_ultimo_pedido()

    if not PEDIDOS_DIR.exists():
        return []

    pastas = []

    for pedido_json in PEDIDOS_DIR.rglob("pedido.json"):
        pasta = pedido_json.parent
        if pedido_pendente(pasta, ultimo_pedido):
            pastas.append(pasta)

    return sorted(pastas, key=lambda p: p.name)

def iniciar_pedido(pasta):
    lock = pasta / "processando.lock"
    lock.write_text("processando", encoding="utf-8")

    if (pasta / "ajuste_pendente.txt").exists():
        handoff = pasta / "processado_handoff.txt"
        if handoff.exists():
            try:
                handoff.unlink()
            except Exception:
                pass

    log(f"🚀 Iniciando pedido: {pasta.name}")

    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"

    return subprocess.Popen(
        ["python", str(PIPELINE), str(pasta)],
        cwd=str(BASE_DIR),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    )

def main():
    ativos = {}

    log("✅ Runner de fila iniciado")
    log(f"⚙️ Limite simultâneo: {MAX_PROCESSOS}")

    while True:
        finalizados = []

        for pasta, info in ativos.items():
            proc = info["proc"]
            inicio = info["inicio"]

            if proc.poll() is not None:
                saida = proc.stdout.read() if proc.stdout else ""

                (pasta / "runner_log.txt").write_text(saida, encoding="utf-8", errors="ignore")

                lock = pasta / "processando.lock"
                if lock.exists():
                    lock.unlink()

                if proc.returncode == 0:
                    duracao = time.time() - inicio
                    registrar_tempo_pedido(duracao)
                    log(f"✅ Finalizado: {pasta.name} ({int(duracao)}s)")
                    salvar_ultimo_pedido(pasta.name)
                else:
                    erro = f"Erro no runner. Código: {proc.returncode}\n\n{saida}"
                    (pasta / "erro_runner.txt").write_text(erro, encoding="utf-8", errors="ignore")

                    try:
                        (pasta / "status.txt").write_text("em_analise", encoding="utf-8")

                        pedido_path = pasta / "pedido.json"
                        if pedido_path.exists():
                            pedido = json.loads(pedido_path.read_text(encoding="utf-8"))
                            pedido["status"] = "em_analise"
                            pedido["motivo_erro"] = "erro_pipeline"
                            pedido["reembolso_pendente"] = True
                            pedido_path.write_text(
                                json.dumps(pedido, ensure_ascii=False, indent=2),
                                encoding="utf-8"
                            )
                    except Exception as e:
                        log(f"⚠️ Não consegui marcar pedido em análise: {e}")

                    avisar_erro_pedido_api(pasta, "erro_pipeline")
                    log(f"❌ Erro: {pasta.name}")

                finalizados.append(pasta)

        for pasta in finalizados:
            ativos.pop(pasta, None)

        vagas = MAX_PROCESSOS - len(ativos)

        if vagas > 0:
            pendentes = pegar_pendentes()

            for pasta in pendentes[:vagas]:
                proc = iniciar_pedido(pasta)
                ativos[pasta] = {
                    "proc": proc,
                    "inicio": time.time()
                }

        qtd_total_fila = len(ativos) + len(pegar_pendentes())
        enviar_tempo_est_api(calcular_tempo_estimado(qtd_total_fila))

        time.sleep(INTERVALO_SEGUNDOS)

if __name__ == "__main__":
    main()











