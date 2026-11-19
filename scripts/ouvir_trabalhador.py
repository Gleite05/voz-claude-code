"""Grava o microfone e transcreve com o Whisper (faster-whisper), tudo local.

Lê do stdin uma linha JSON por ordem:
  {"ordem": "gravar"}                       começa a gravar (até "parar")
  {"ordem": "parar", "idioma": "pt"}        pára e transcreve -> {"texto": "..."}
  {"ordem": "cancelar"}                     pára sem transcrever (também interrompe um "escutar")
  {"ordem": "escutar", "idioma": "pt", "espera": 6, "silencio": 1.2, "max": 30}
      grava sozinho: espera até `espera` s que comeces a falar, pára quando ficas `silencio` s calado
      (ou ao fim de `max` s) e transcreve -> {"texto": "...", "semFala": bool}
  {"ordem": "acabar"}                       termina já um "escutar" em curso e transcreve o que ouviu
A primeira linha que escreve é {"pronto": true} (ou o erro de carregamento).
Cada ordem recebe exatamente uma resposta, pela ordem em que chegou.
"""

import json
import queue
import sys
import threading
import time

TAXA = 16000
BLOCO_S = 0.03  # deteção de voz em blocos de 30 ms


def main() -> int:
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    pasta_modelos = sys.argv[1]
    nome_modelo = sys.argv[2] if len(sys.argv) > 2 else "small"
    try:
        import numpy as np
        import sounddevice as sd
        from faster_whisper import WhisperModel

        modelo = WhisperModel(nome_modelo, device="cpu", compute_type="int8", download_root=pasta_modelos)
    except Exception as erro:  # noqa: BLE001
        print(json.dumps({"pronto": False, "erro": f"{type(erro).__name__}: {erro}"}), flush=True)
        return 1
    print(json.dumps({"pronto": True}), flush=True)

    blocos = []
    trinco = threading.Lock()
    fluxo = None
    # Os sinais «cancelar» e «acabar» têm de chegar a meio de um «escutar»: o stdin é lido noutra thread.
    ordens = queue.Queue()
    cancelar = threading.Event()
    acabar = threading.Event()

    def ler_stdin():
        for linha in sys.stdin:
            linha = linha.strip()
            if not linha:
                continue
            try:
                p = json.loads(linha)
            except Exception:  # noqa: BLE001
                p = {"ordem": "?"}
            if p.get("ordem") == "cancelar":
                cancelar.set()
            elif p.get("ordem") == "acabar":
                acabar.set()
            ordens.put(p)
        ordens.put(None)

    threading.Thread(target=ler_stdin, daemon=True).start()

    def ao_gravar(dados, _frames, _tempo, _estado):
        with trinco:
            blocos.append(dados.copy())

    def responder(obj):
        print(json.dumps(obj, ensure_ascii=False), flush=True)

    def abrir():
        nonlocal fluxo
        with trinco:
            blocos.clear()
        if fluxo is None:
            fluxo = sd.InputStream(samplerate=TAXA, channels=1, dtype="float32", callback=ao_gravar, blocksize=int(TAXA * BLOCO_S))
            fluxo.start()

    def fechar():
        nonlocal fluxo
        if fluxo is not None:
            fluxo.stop()
            fluxo.close()
            fluxo = None
        with trinco:
            audio = np.concatenate(blocos)[:, 0] if blocos else np.zeros(0, dtype="float32")
            blocos.clear()
        return audio

    def transcrever(audio, idioma):
        segmentos, _info = modelo.transcribe(audio, language=idioma or None, vad_filter=True, beam_size=1)
        return " ".join(s.text.strip() for s in segmentos).strip()

    def escutar(p):
        """Grava com deteção de voz por energia (o limiar adapta-se ao ruído da sala)."""
        espera = float(p.get("espera") or 6)
        silencio = float(p.get("silencio") or 1.2)
        maximo = float(p.get("max") or 30)
        cancelar.clear()
        acabar.clear()
        abrir()
        inicio = time.time()
        ruido = None
        falou = False
        ultima_fala = inicio
        lidos = 0
        while True:
            time.sleep(BLOCO_S)
            if cancelar.is_set():
                fechar()
                return {"ok": True, "texto": "", "cancelado": True}
            with trinco:
                novos = blocos[lidos:]
                lidos = len(blocos)
            agora = time.time()
            for b in novos:
                e = float(np.sqrt(np.mean(b[:, 0] ** 2)))
                if ruido is None:
                    ruido = e
                limiar = max(0.012, ruido * 3.2)
                if e > limiar:
                    falou = True
                    ultima_fala = agora
                elif not falou:
                    ruido = ruido * 0.95 + e * 0.05  # aprende o ruído de fundo antes de falares
            if acabar.is_set():
                break
            if not falou and agora - inicio > espera:
                fechar()
                return {"ok": True, "texto": "", "semFala": True}
            if falou and agora - ultima_fala > silencio:
                break
            if agora - inicio > maximo:
                break
        audio = fechar()
        if len(audio) < TAXA * 0.4:
            return {"ok": True, "texto": "", "semFala": True}
        texto = transcrever(audio, p.get("idioma"))
        return {"ok": True, "texto": texto, "semFala": not texto, "segundos": round(len(audio) / TAXA, 1)}

    while True:
        pedido = ordens.get()
        if pedido is None:
            break
        try:
            ordem = pedido.get("ordem")
            if ordem == "gravar":
                cancelar.clear()
                abrir()
                responder({"ok": True, "a_gravar": True})
            elif ordem == "escutar":
                responder(escutar(pedido))
            elif ordem == "acabar":
                acabar.clear()
                responder({"ok": True})
            elif ordem in ("parar", "cancelar"):
                if ordem == "cancelar":
                    cancelar.clear()
                audio = fechar()
                if ordem == "cancelar" or len(audio) < TAXA * 0.4:
                    responder({"ok": True, "texto": ""})
                    continue
                texto = transcrever(audio, pedido.get("idioma"))
                responder({"ok": True, "texto": texto, "segundos": round(len(audio) / TAXA, 1)})
            else:
                responder({"ok": False, "erro": "ordem desconhecida"})
        except Exception as erro:  # noqa: BLE001
            responder({"ok": False, "erro": f"{type(erro).__name__}: {erro}"})
    return 0


if __name__ == "__main__":
    sys.exit(main())
