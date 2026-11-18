"""Grava o microfone e transcreve com o Whisper (faster-whisper), tudo local.

Lê do stdin uma linha JSON por ordem:
  {"ordem": "gravar"}                       começa a gravar
  {"ordem": "parar", "idioma": "pt"}        pára e transcreve -> {"texto": "..."}
  {"ordem": "cancelar"}                     pára sem transcrever
A primeira linha que escreve é {"pronto": true} (ou o erro de carregamento).
"""

import json
import sys
import threading

TAXA = 16000


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

    def ao_gravar(dados, _frames, _tempo, _estado):
        with trinco:
            blocos.append(dados.copy())

    def responder(obj):
        print(json.dumps(obj, ensure_ascii=False), flush=True)

    for linha in sys.stdin:
        linha = linha.strip()
        if not linha:
            continue
        try:
            pedido = json.loads(linha)
            ordem = pedido.get("ordem")
            if ordem == "gravar":
                with trinco:
                    blocos.clear()
                if fluxo is None:
                    fluxo = sd.InputStream(samplerate=TAXA, channels=1, dtype="float32", callback=ao_gravar)
                    fluxo.start()
                responder({"ok": True, "a_gravar": True})
            elif ordem in ("parar", "cancelar"):
                if fluxo is not None:
                    fluxo.stop()
                    fluxo.close()
                    fluxo = None
                with trinco:
                    audio = np.concatenate(blocos)[:, 0] if blocos else np.zeros(0, dtype="float32")
                    blocos.clear()
                if ordem == "cancelar" or len(audio) < TAXA * 0.4:
                    responder({"ok": True, "texto": ""})
                    continue
                segmentos, _info = modelo.transcribe(
                    audio, language=pedido.get("idioma") or None, vad_filter=True, beam_size=1
                )
                texto = " ".join(s.text.strip() for s in segmentos).strip()
                responder({"ok": True, "texto": texto, "segundos": round(len(audio) / TAXA, 1)})
            else:
                responder({"ok": False, "erro": "ordem desconhecida"})
        except Exception as erro:  # noqa: BLE001
            responder({"ok": False, "erro": f"{type(erro).__name__}: {erro}"})
    return 0


if __name__ == "__main__":
    sys.exit(main())
