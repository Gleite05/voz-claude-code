"""Mantém a voz Piper carregada e sintetiza um WAV por pedido.

Lê do stdin uma linha JSON por pedido: {"texto": ..., "ficheiro": ..., "escala": 1.0}
Responde no stdout com uma linha JSON: {"ok": true} ou {"ok": false, "erro": "..."}
A primeira linha que escreve é {"pronto": true} (ou o erro de carregamento).
"""

import json
import sys
import wave


def main() -> int:
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        from piper import PiperVoice, SynthesisConfig

        voz = PiperVoice.load(sys.argv[1])
    except Exception as erro:  # noqa: BLE001
        print(json.dumps({"pronto": False, "erro": str(erro)}), flush=True)
        return 1
    print(json.dumps({"pronto": True}), flush=True)

    for linha in sys.stdin:
        linha = linha.strip()
        if not linha:
            continue
        try:
            pedido = json.loads(linha)
            config = SynthesisConfig(
                length_scale=float(pedido.get("escala") or 1.0),
                noise_scale=float(pedido.get("ruido") or 0.4),
                noise_w_scale=float(pedido.get("ruidoDuracao") or 0.5),
            )
            with wave.open(pedido["ficheiro"], "wb") as saida:
                voz.synthesize_wav(pedido["texto"], saida, syn_config=config)
            print(json.dumps({"ok": True}), flush=True)
        except Exception as erro:  # noqa: BLE001
            print(json.dumps({"ok": False, "erro": str(erro)}), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
